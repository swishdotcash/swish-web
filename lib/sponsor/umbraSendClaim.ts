/**
 * Umbra Send & Claim — flipped burner pattern.
 *
 * The sender does an Umbra Direct Send (client-side, 3 wallet sigs) to a
 * fresh per-SC burner. Funds enter the Umbra pool with sender-side
 * privacy. On recipient claim, the server uses the burner's keys
 * (decrypted via passphrase or session sig) to claim the receiver-
 * claimable UTXO into the burner's encrypted balance, withdraws to the
 * burner's own ATA, then SPL-transfers to the recipient. From the
 * recipient's POV it's a single SPL deposit landing in their wallet —
 * no Umbra knowledge required.
 *
 * Flow split:
 *   1. PREPARE (server): generate burner, register on Umbra, persist
 *      activity row in `processing` state with burner key encrypted for
 *      receiver (passphrase) and sender (session sig).
 *   2. CLIENT (browser): Umbra Direct Send to burner address (3 sigs).
 *   3. RECORD (server): client posts deposit signatures, server marks
 *      activity `open` and returns the claim link.
 *   4. CLAIM (server, recipient with passphrase): claim the burner's
 *      ReceiverClaimable UTXO into encrypted balance → withdraw to
 *      burner ATA → SPL transfer to recipient ATA.
 *   5. RECLAIM (server, sender with session sig): same as claim but
 *      destination is the sender.
 *
 * Cost (sponsor-paid):
 *   - Burner registration on Umbra (~$0.60 net, after SDK auto-reclaims
 *     computation rent via the default `reclaimComputationRent: true`)
 *   - Claim + withdraw + SPL transfer at recipient time (~$0.001 gas)
 *   - Total per Umbra SC: ~$0.96 sponsor + 0.7% recipient claim fee
 *     (intrinsic to Umbra's protocol).
 *
 * Why we don't use a single permanent vault (SUV): per-SC burner keeps
 * isolation (no shared-balance drift) and is simpler to reason about
 * for v1. SUV is on the post-hackathon roadmap (see SUV memory).
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import {
  getClaimableUtxoScannerFunction,
  getEncryptedBalanceQuerierFunction,
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction,
  getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction,
} from "@umbra-privacy/sdk";

import { TOKEN_MINTS, TokenType } from "../privacycash/tokens";
import {
  createActivity,
  getActivity,
  claimActivity,
  updateActivityStatus,
} from "../database";
import {
  generatePassphrase,
  encryptWithPassphrase,
  decryptWithPassphrase,
  encryptWithSessionSignature,
  decryptWithSessionSignature,
  PassphraseEncryptedPayload,
} from "../crypto";
import { loadSponsorWallet } from "./sponsorWallet";
import {
  createBurner,
  ensureBurnerSol,
  registerBurnerOnUmbra,
  sweepBurnerSol,
} from "./umbraBurner";
import {
  createUmbraSignerFromKeypair,
  getServerUmbraClient,
  getUmbraProverSuite,
} from "./umbraSDK";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN_DECIMALS: Record<TokenType, number> = {
  USDC: 6,
  USDT: 6,
  SOL: 9,
};

// ============================================================
// PREPARE — server-side burner provisioning
// ============================================================

export interface PrepareUmbraScBurnerParams {
  senderPublicKey: PublicKey;
  sessionSignature: Uint8Array;
  amount: number;
  token: TokenType;
  message?: string;
  providerId: string;
}

export interface PrepareUmbraScBurnerResult {
  activityId: string;
  burnerAddress: string;
  passphrase: string;
}

/**
 * Generate a fresh burner, register it on Umbra (sponsored), and
 * persist an activity row in `processing` state. Client will then do
 * an Umbra Direct Send to the returned burner address. The burner
 * key is encrypted twice — for the receiver via passphrase, and for
 * the sender via session signature (for reclaim).
 */
export async function prepareUmbraScBurner(
  params: PrepareUmbraScBurnerParams
): Promise<PrepareUmbraScBurnerResult> {
  const {
    senderPublicKey,
    sessionSignature,
    amount,
    token,
    message,
    providerId,
  } = params;

  if (token !== "USDC") {
    throw new Error("Umbra Send & Claim only supports USDC for v1");
  }

  const burner = createBurner();
  const passphrase = generatePassphrase();
  const burnerSecretKey = burner.keypair.secretKey;

  const encryptedForReceiver = encryptWithPassphrase(
    burnerSecretKey,
    passphrase
  );
  const encryptedForSender = encryptWithSessionSignature(
    burnerSecretKey,
    sessionSignature
  );

  // Top up burner SOL + register on Umbra. This is the bulk of the
  // ~$0.60 sponsor cost. Doing it here (vs at record time) means the
  // burner is ready to receive a Direct Send the moment the client
  // gets the address back.
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL not configured");
  const connection = new Connection(rpcUrl, "confirmed");

  await ensureBurnerSol(connection, burner.keypair.publicKey);
  await registerBurnerOnUmbra(burner.keypair);

  const mint = TOKEN_MINTS[token];
  const activity = await createActivity({
    type: "send_claim",
    sender_address: senderPublicKey.toBase58(),
    receiver_address: null,
    amount,
    token_address: mint.toBase58(),
    // Stays in `processing` until the client posts back the deposit
    // signatures via /api/umbra/sc/record. Recipients can't claim
    // a `processing` row.
    status: "processing",
    message: message || null,
    tx_hash: null,
    burner_address: burner.address,
    encrypted_for_receiver: encryptedForReceiver,
    encrypted_for_sender: encryptedForSender,
    provider_id: providerId,
  });

  return {
    activityId: activity.id,
    burnerAddress: burner.address,
    passphrase,
  };
}

// ============================================================
// RECORD — client confirms deposit completed
// ============================================================

export interface RecordUmbraScDepositParams {
  activityId: string;
  senderPublicKey: PublicKey;
  createUtxoSignature: string;
  createProofAccountSignature: string;
  closeProofAccountSignature?: string;
}

export interface RecordUmbraScDepositResult {
  activityId: string;
  claimLink: string;
  burnerAddress: string;
}

/**
 * After the client completes the Umbra Direct Send to the burner,
 * mark the activity row as `open` (claimable by recipient) and
 * return the claim link. We don't independently verify the deposit
 * landed — at worst the recipient's claim will fail when scanning
 * for the UTXO, which they can retry. No funds at stake here since
 * the UTXO is on-chain regardless.
 */
export async function recordUmbraScDeposit(
  params: RecordUmbraScDepositParams
): Promise<RecordUmbraScDepositResult> {
  const {
    activityId,
    senderPublicKey,
    createUtxoSignature,
    createProofAccountSignature,
  } = params;

  const activity = await getActivity(activityId);
  if (!activity) throw new Error("Activity not found");
  if (activity.type !== "send_claim") {
    throw new Error("Not a send_claim activity");
  }
  if (activity.status !== "processing") {
    throw new Error(`Activity is in ${activity.status} state`);
  }
  if (activity.sender_address !== senderPublicKey.toBase58()) {
    throw new Error("Not authorized to record this send");
  }
  if (!activity.burner_address) {
    throw new Error("Activity missing burner data");
  }

  // tx_hash = createUtxo signature (canonical Umbra deposit
  // signature); deposit_tx_hash captures the proof-account staging tx
  // for audit trail.
  await updateActivityStatus(activityId, "open", {
    tx_hash: createUtxoSignature,
    deposit_tx_hash: createProofAccountSignature,
    provider_id: "umbra",
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://swish.cash";
  const claimLink = `${baseUrl}/c/${activityId}`;

  return {
    activityId,
    claimLink,
    burnerAddress: activity.burner_address,
  };
}

// ============================================================
// CLAIM (recipient with passphrase)
// ============================================================

export interface ClaimUmbraSendClaimParams {
  connection: Connection;
  activityId: string;
  passphrase: string;
  receiverAddress: string;
  sponsorKeypair: Keypair;
  providerId: string;
}

export interface ClaimUmbraSendClaimResult {
  activityId: string;
  claimTx: string;
  amountReceived: number;
  token: TokenType;
}

export async function claimUmbraSendClaim(
  params: ClaimUmbraSendClaimParams
): Promise<ClaimUmbraSendClaimResult> {
  const {
    connection,
    activityId,
    passphrase,
    receiverAddress,
    sponsorKeypair,
  } = params;

  const fetchedActivity = await getActivity(activityId);
  if (!fetchedActivity) throw new Error("Claim link not found");
  if (fetchedActivity.type !== "send_claim") throw new Error("Not a claim link");
  if (!fetchedActivity.encrypted_for_receiver || !fetchedActivity.burner_address) {
    throw new Error("Invalid claim link data");
  }

  // Atomically lock — only one claimer wins.
  const activity = await claimActivity(activityId);
  if (!activity) throw new Error("Claim link already used or cancelled");

  let burnerSecretKey: Uint8Array;
  try {
    burnerSecretKey = decryptWithPassphrase(
      activity.encrypted_for_receiver as PassphraseEncryptedPayload,
      passphrase
    );
  } catch {
    await updateActivityStatus(activityId, "open");
    throw new Error("Invalid passphrase");
  }

  const burnerKeypair = Keypair.fromSecretKey(burnerSecretKey);
  if (burnerKeypair.publicKey.toBase58() !== activity.burner_address) {
    await updateActivityStatus(activityId, "open");
    throw new Error("Burner key mismatch - invalid passphrase");
  }

  try {
    const claimTx = await runUmbraClaimToRecipient({
      connection,
      burnerKeypair,
      recipientAddress: receiverAddress,
      sponsorKeypair,
    });

    await updateActivityStatus(activityId, "settled", {
      claim_tx_hash: claimTx,
      receiver_address: receiverAddress,
      provider_id: "umbra",
    });

    return {
      activityId,
      claimTx,
      amountReceived: activity.amount,
      token: "USDC",
    };
  } catch (err) {
    await updateActivityStatus(activityId, "open");
    throw err;
  }
}

// ============================================================
// RECLAIM (sender with session sig)
// ============================================================

export interface ReclaimUmbraSendClaimParams {
  connection: Connection;
  activityId: string;
  sessionSignature: Uint8Array;
  senderPublicKey: PublicKey;
  sponsorKeypair: Keypair;
}

export interface ReclaimUmbraSendClaimResult {
  activityId: string;
  reclaimTx: string;
  amountReclaimed: number;
  token: TokenType;
}

export async function reclaimUmbraSendClaim(
  params: ReclaimUmbraSendClaimParams
): Promise<ReclaimUmbraSendClaimResult> {
  const {
    connection,
    activityId,
    sessionSignature,
    senderPublicKey,
    sponsorKeypair,
  } = params;

  const fetchedActivity = await getActivity(activityId);
  if (!fetchedActivity) throw new Error("Activity not found");
  if (fetchedActivity.type !== "send_claim") throw new Error("Not a claim link");
  if (fetchedActivity.sender_address !== senderPublicKey.toBase58()) {
    throw new Error("Only the sender can reclaim");
  }
  if (!fetchedActivity.encrypted_for_sender || !fetchedActivity.burner_address) {
    throw new Error("Invalid activity data");
  }

  const activity = await claimActivity(activityId);
  if (!activity) throw new Error("Already claimed or cancelled");

  let burnerSecretKey: Uint8Array;
  try {
    burnerSecretKey = decryptWithSessionSignature(
      activity.encrypted_for_sender as PassphraseEncryptedPayload,
      sessionSignature
    );
  } catch {
    await updateActivityStatus(activityId, "open");
    throw new Error("Invalid session signature");
  }

  const burnerKeypair = Keypair.fromSecretKey(burnerSecretKey);
  if (burnerKeypair.publicKey.toBase58() !== activity.burner_address) {
    await updateActivityStatus(activityId, "open");
    throw new Error("Burner key mismatch");
  }

  try {
    const reclaimTx = await runUmbraClaimToRecipient({
      connection,
      burnerKeypair,
      recipientAddress: senderPublicKey.toBase58(),
      sponsorKeypair,
    });

    await updateActivityStatus(activityId, "cancelled", {
      claim_tx_hash: reclaimTx,
    });

    return {
      activityId,
      reclaimTx,
      amountReclaimed: activity.amount,
      token: "USDC",
    };
  } catch (err) {
    await updateActivityStatus(activityId, "open");
    throw err;
  }
}

// ============================================================
// SHARED — drive Umbra claim → withdraw to burner ATA → SPL transfer
// ============================================================

interface RunUmbraClaimArgs {
  connection: Connection;
  burnerKeypair: Keypair;
  recipientAddress: string;
  sponsorKeypair: Keypair;
}

/**
 * Three-step recipient claim:
 *   1. Burner scans for ReceiverClaimable UTXOs at its address (the
 *      sender's Umbra Direct Send landed here). Claims them into
 *      burner's encrypted balance — fires the 0.7% Umbra protocol+
 *      relayer claim fee, settled via Arcium MPC (~10-15s).
 *   2. Burner withdraws encrypted balance → burner's own ATA
 *      (Umbra direct withdrawer, 0% fee).
 *   3. Sponsor-paid SPL transfer from burner ATA → recipient's
 *      mainnet ATA, creating the recipient ATA if missing.
 *
 * Returns the SPL transfer signature (canonical "money landed in
 * recipient's wallet" signature).
 *
 * Burner needs SOL on hand for tx fees — top up at start, sweep
 * leftover at end. Sponsor pays everything.
 */
async function runUmbraClaimToRecipient(
  args: RunUmbraClaimArgs
): Promise<string> {
  const { connection, burnerKeypair, recipientAddress, sponsorKeypair } = args;

  // Top up burner SOL for the claim + withdraw txs.
  await ensureBurnerSol(connection, burnerKeypair.publicKey);

  const signer = await createUmbraSignerFromKeypair(burnerKeypair);
  const client = await getServerUmbraClient({ signer });
  const suite = getUmbraProverSuite();

  // Step 1a: scan claimable UTXOs at burner's address. Sender's
  // Direct Send landed in the `publicReceived` bucket (public-balance
  // deposit sent to us by another party).
  const scanner = getClaimableUtxoScannerFunction({ client });
  const scanResult = await scanner(BigInt(0) as any, BigInt(0) as any);
  const receiverClaimableUtxos = scanResult.publicReceived;

  if (receiverClaimableUtxos.length === 0) {
    throw new Error(
      "No receiver-claimable UTXOs found at burner address. Sender's deposit may not have settled yet."
    );
  }

  // Step 1b: claim receiver-claimable UTXOs into burner's encrypted
  // balance. 0.7% protocol + relayer fee fires here. Relayer is
  // constructed once and reused.
  const relayer = await getServerUmbraRelayer();
  const claimer = getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction(
    { client },
    {
      zkProver: suite.claimReceiverClaimableIntoEncryptedBalance as any,
      relayer: relayer as any,
      fetchBatchMerkleProof: (client as any).fetchBatchMerkleProof,
    } as any
  );
  await claimer(receiverClaimableUtxos as any);

  // Step 2: poll for Arcium MPC to credit the burner's encrypted
  // balance. Relayer-submitted claim tx lands quickly; Arcium takes
  // ~10-15s to finalize the encrypted-balance update. Without this
  // poll, step 3 fires before the credit lands and withdraw fails
  // with "amount > available".
  const POLL_INTERVAL_MS = 2_000;
  const POLL_TIMEOUT_MS = 35_000;
  const querier = getEncryptedBalanceQuerierFunction({ client });
  const start = Date.now();
  let availableBaseUnits: bigint = BigInt(0);
  while (
    availableBaseUnits === BigInt(0) &&
    Date.now() - start < POLL_TIMEOUT_MS
  ) {
    const balanceMap = await querier([USDC_MINT as any]);
    const usdcResult = balanceMap.get(USDC_MINT as any);
    if (usdcResult && (usdcResult as any).state === "shared") {
      availableBaseUnits = (usdcResult as any).balance as bigint;
    }
    if (availableBaseUnits === BigInt(0)) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  if (availableBaseUnits === BigInt(0)) {
    throw new Error(
      "Claim succeeded but encrypted balance still 0 after 35s. Arcium MPC may still be settling — try again in a moment."
    );
  }

  // Step 3: withdraw encrypted balance → burner's own ATA. 0% fee.
  // Use the actual settled amount (Umbra's claim fee already came out).
  const burnerAta = await getAssociatedTokenAddress(
    new PublicKey(USDC_MINT),
    burnerKeypair.publicKey
  );
  const withdraw = getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction(
    { client }
  );
  await withdraw(
    burnerKeypair.publicKey.toBase58() as any,
    USDC_MINT as any,
    availableBaseUnits as any
  );

  // Step 4: SPL transfer from burner ATA → recipient ATA. Sponsor
  // pays gas + creates recipient ATA if missing. This is the tx the
  // recipient sees as "money arrived in my wallet".
  const transferSig = await splTransferToRecipient({
    connection,
    burnerKeypair,
    sponsorKeypair,
    recipientAddress,
    amountBaseUnits: availableBaseUnits,
  });

  // Best-effort sweep leftover SOL back to sponsor.
  await sweepBurnerSol(connection, burnerKeypair).catch(() => null);

  return transferSig;
}

// Cached relayer instance (constructor is cheap but caching avoids repeats).
let cachedRelayer: any | null = null;
async function getServerUmbraRelayer() {
  if (cachedRelayer) return cachedRelayer;
  const { getUmbraRelayer } = await import("@umbra-privacy/sdk");
  const apiEndpoint =
    process.env.UMBRA_RELAYER_URL || "https://relayer.api.umbraprivacy.com";
  cachedRelayer = getUmbraRelayer({ apiEndpoint });
  return cachedRelayer;
}

// ============================================================
// SPL transfer helper — burner ATA → recipient ATA
// ============================================================

interface SplTransferArgs {
  connection: Connection;
  burnerKeypair: Keypair;
  sponsorKeypair: Keypair;
  recipientAddress: string;
  amountBaseUnits: bigint;
}

/**
 * Builds and sends a sponsor-paid SPL transfer from burner ATA to
 * recipient ATA. Creates the recipient ATA on the fly if missing
 * (sponsor pays the rent ~0.002 SOL).
 *
 * Sponsor is fee payer. Burner signs as token authority. No user
 * signature involved (this is server-side at recipient claim time).
 */
async function splTransferToRecipient(args: SplTransferArgs): Promise<string> {
  const {
    connection,
    burnerKeypair,
    sponsorKeypair,
    recipientAddress,
    amountBaseUnits,
  } = args;

  const mint = new PublicKey(USDC_MINT);
  const recipient = new PublicKey(recipientAddress);

  const burnerAta = await getAssociatedTokenAddress(mint, burnerKeypair.publicKey);
  const recipientAta = await getAssociatedTokenAddress(mint, recipient);

  const instructions: any[] = [];

  // Create recipient ATA if missing — sponsor pays rent.
  let recipientAtaExists = true;
  try {
    await getAccount(connection, recipientAta);
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) {
      recipientAtaExists = false;
    } else {
      throw err;
    }
  }
  if (!recipientAtaExists) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        sponsorKeypair.publicKey,
        recipientAta,
        recipient,
        mint
      )
    );
  }

  instructions.push(
    createTransferInstruction(
      burnerAta,
      recipientAta,
      burnerKeypair.publicKey,
      amountBaseUnits
    )
  );

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const messageV0 = new TransactionMessage({
    payerKey: sponsorKeypair.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([sponsorKeypair, burnerKeypair]);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}
