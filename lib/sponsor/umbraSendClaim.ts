/**
 * Umbra Send & Claim — burner pattern (server-side).
 *
 * Mirrors the PC SC architecture (see prepareAndSubmitClaim.ts) but the
 * burner deposits a self-claimable UTXO into Umbra instead of a PC SPL
 * deposit. On claim/reclaim, the server uses the burner's keys (decrypted
 * via passphrase or session sig) to claim the UTXO into the burner's
 * encrypted balance, then withdraws to the recipient's / sender's mainnet
 * ATA.
 *
 * Cost (sponsor-paid):
 *   - Burner registration on Umbra (~$0.60 net, after SDK auto-reclaims
 *     computation rent via the default `reclaimComputationRent: true`)
 *   - Self-claimable deposit (~$0.32)
 *   - Total per Umbra SC: ~$0.96
 *
 * For why we sponsor instead of using a single hub or burner pool, see
 * the conversation 2026-05-01 — burner-per-SC keeps per-SC isolation
 * (no drift on a shared balance) at a price the sponsor can absorb until
 * Umbra ships a close-ix or sponsor co-signing.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
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
  getSelfClaimableUtxoToEncryptedBalanceClaimerFunction,
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
  depositToSelfClaimable,
  ensureBurnerSol,
  registerBurnerOnUmbra,
  buildSenderToBurnerTransferTx,
  submitSenderToBurnerTransfer,
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
// PREPARE
// ============================================================

export interface PrepareUmbraSendClaimParams {
  connection: Connection;
  senderPublicKey: PublicKey;
  sessionSignature: Uint8Array;
  amount: number;
  token: TokenType;
  message?: string;
  providerId: string;
}

export interface PrepareUmbraSendClaimResult {
  activityId: string;
  unsignedDepositTx: string;
  lastValidBlockHeight: number;
  passphrase: string;
  burnerAddress: string;
  estimatedFeeLamports: number;
  estimatedFeeSOL: number;
}

export async function prepareUmbraSendClaim(
  params: PrepareUmbraSendClaimParams
): Promise<PrepareUmbraSendClaimResult> {
  const {
    connection,
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

  const baseUnits = BigInt(Math.floor(amount * 10 ** TOKEN_DECIMALS[token]));
  const mint = TOKEN_MINTS[token];

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

  const transfer = await buildSenderToBurnerTransferTx({
    connection,
    senderPubkey: senderPublicKey,
    burnerPubkey: burner.keypair.publicKey,
    amountBaseUnits: baseUnits,
    mint,
  });

  const activity = await createActivity({
    type: "send_claim",
    sender_address: senderPublicKey.toBase58(),
    receiver_address: null,
    amount,
    token_address: mint.toBase58(),
    status: "open",
    message: message || null,
    tx_hash: null,
    burner_address: burner.address,
    encrypted_for_receiver: encryptedForReceiver,
    encrypted_for_sender: encryptedForSender,
    provider_id: providerId,
  });

  return {
    activityId: activity.id,
    unsignedDepositTx: transfer.unsignedTxBase64,
    lastValidBlockHeight: transfer.lastValidBlockHeight,
    passphrase,
    burnerAddress: burner.address,
    // Sponsor pays the SPL transfer fee. Surface ~5000 lamports for UI parity
    // with PC.
    estimatedFeeLamports: 5000,
    estimatedFeeSOL: 0.000005,
  };
}

// ============================================================
// SUBMIT (sender's session signature required to decrypt burner key)
// ============================================================

export interface SubmitUmbraSendClaimParams {
  connection: Connection;
  signedDepositTx: string;
  activityId: string;
  senderPublicKey: PublicKey;
  sessionSignature: Uint8Array;
  lastValidBlockHeight?: number;
}

export interface SubmitUmbraSendClaimResult {
  activityId: string;
  depositTx: string; // sender→burner SPL transfer signature
  withdrawTx: string; // Umbra createUtxo signature
  claimLink: string;
  burnerAddress: string;
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
      tx_hash: claimTx,
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
// SHARED — drive Umbra claim → recipient's mainnet ATA
// ============================================================

interface RunUmbraClaimArgs {
  connection: Connection;
  burnerKeypair: Keypair;
  recipientAddress: string;
  sponsorKeypair: Keypair;
}

/**
 * Two-step Umbra claim → recipient's mainnet ATA:
 *   1. Burner scans for self-claimable UTXOs at its address (ephemeral
 *      bucket). Claims them into burner's encrypted balance.
 *   2. Burner withdraws encrypted balance → recipient's mainnet ATA in a
 *      single tx (Umbra's direct withdrawer accepts any destination).
 *
 * Burner needs SOL on hand for tx fees — we top up at the start and sweep
 * any leftover at the end. Sponsor pays.
 */
async function runUmbraClaimToRecipient(
  args: RunUmbraClaimArgs
): Promise<string> {
  const { connection, burnerKeypair, recipientAddress } = args;

  // Top up burner SOL for the claim + withdraw txs.
  await ensureBurnerSol(connection, burnerKeypair.publicKey);

  const signer = await createUmbraSignerFromKeypair(burnerKeypair);
  const client = await getServerUmbraClient({ signer });
  const suite = getUmbraProverSuite();

  // Step 1: scan claimable UTXOs at burner's address.
  // Scanner takes (treeIndex: U32, startInsertionIndex: U32, endInsertionIndex?: U32) — bigint args.
  const scanner = getClaimableUtxoScannerFunction({ client });
  const scanResult = await scanner(BigInt(0) as any, BigInt(0) as any);
  // Our deposit was via getPublicBalanceToSelfClaimableUtxoCreatorFunction,
  // so UTXOs land in the `publicSelfBurnable` bucket.
  const selfClaimableUtxos = scanResult.publicSelfBurnable;

  if (selfClaimableUtxos.length === 0) {
    throw new Error(
      "No self-claimable UTXOs found at burner address. Deposit may not have settled yet."
    );
  }

  // Step 2: claim self-claimable UTXOs into burner's encrypted balance.
  // Requires zkProver + relayer + fetchBatchMerkleProof. The relayer is
  // constructed once and reused across claims. fetchBatchMerkleProof
  // defaults from client (uses the indexer config).
  const relayer = await getServerUmbraRelayer();
  const claimer = getSelfClaimableUtxoToEncryptedBalanceClaimerFunction(
    { client },
    {
      zkProver:
        suite.claimReceiverClaimableIntoEncryptedBalance as any,
      relayer: relayer as any,
      fetchBatchMerkleProof: (client as any).fetchBatchMerkleProof,
    } as any
  );
  await claimer(selfClaimableUtxos as any);

  // Step 3: poll for Arcium MPC to credit the burner's encrypted balance.
  // The relayer-submitted claim tx lands quickly, but Arcium MPC takes
  // ~10-15s to finalize the encrypted-balance update. Without polling,
  // step 4 fires before the credit lands and the withdraw fails with
  // "amount > available". Poll every 2s for up to 35s.
  const POLL_INTERVAL_MS = 2_000;
  const POLL_TIMEOUT_MS = 35_000;
  const querier = getEncryptedBalanceQuerierFunction({ client });
  const start = Date.now();
  let availableBaseUnits: bigint = BigInt(0);
  while (availableBaseUnits === BigInt(0) && Date.now() - start < POLL_TIMEOUT_MS) {
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

  // Step 4: withdraw encrypted balance → recipient's mainnet ATA.
  // Use the actual settled amount (Umbra fees may have shaved it slightly).
  const withdraw = getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction(
    { client }
  );
  const withdrawSig = await withdraw(
    recipientAddress as any,
    USDC_MINT as any,
    availableBaseUnits as any
  );

  // Best-effort sweep leftover SOL back to sponsor.
  await sweepBurnerSol(connection, burnerKeypair).catch(() => null);

  return withdrawSig.toString();
}

// Cached relayer instance (constructor is cheap but caching avoids repeats).
let cachedRelayer: any | null = null;
async function getServerUmbraRelayer() {
  if (cachedRelayer) return cachedRelayer;
  const { getUmbraRelayer } = await import("@umbra-privacy/sdk");
  const apiEndpoint =
    process.env.UMBRA_RELAYER_URL ||
    "https://relayer.api.umbraprivacy.com";
  cachedRelayer = getUmbraRelayer({ apiEndpoint });
  return cachedRelayer;
}

// ============================================================
// SUBMIT — implementation
// ============================================================

export async function submitUmbraSendClaim(
  params: SubmitUmbraSendClaimParams
): Promise<SubmitUmbraSendClaimResult> {
  const {
    connection,
    signedDepositTx,
    activityId,
    senderPublicKey,
    sessionSignature,
  } = params;

  const activity = await getActivity(activityId);
  if (!activity) throw new Error("Activity not found");
  if (activity.type !== "send_claim") {
    throw new Error("Not a send_claim activity");
  }
  if (activity.status !== "open") {
    throw new Error(`Activity is already ${activity.status}`);
  }
  if (activity.sender_address !== senderPublicKey.toBase58()) {
    throw new Error("Not authorized to submit this send");
  }
  if (!activity.burner_address || !activity.encrypted_for_sender) {
    throw new Error("Activity missing burner data");
  }

  // Decrypt burner privkey using sender's session signature (same as PC SC).
  const burnerSecretKey = decryptWithSessionSignature(
    activity.encrypted_for_sender as PassphraseEncryptedPayload,
    sessionSignature
  );
  const burnerKeypair = Keypair.fromSecretKey(burnerSecretKey);
  if (burnerKeypair.publicKey.toBase58() !== activity.burner_address) {
    throw new Error("Burner key mismatch");
  }

  await updateActivityStatus(activityId, "processing");

  try {
    // Step 1: submit user-signed sender→burner SPL transfer.
    const depositTx = await submitSenderToBurnerTransfer(
      connection,
      signedDepositTx,
      params.lastValidBlockHeight ?? 0
    );

    // Step 2: ensure burner has SOL for registration + deposit txs.
    await ensureBurnerSol(connection, burnerKeypair.publicKey);

    // Step 3: register burner on Umbra. Required for self-claimable
    // (burner needs an EncryptedUserAccount to be the receiver of its own
    // self-claimable UTXO). One-time per burner. SDK auto-reclaims
    // computation rent via default `reclaimComputationRent: true`, so net
    // cost is ~0.003 SOL (~$0.60).
    await registerBurnerOnUmbra(burnerKeypair);

    // Step 4: burner deposits self-claimable UTXO. UTXO is locked to the
    // burner's commitment; recipient claims it via passphrase-decrypted
    // burner key.
    const baseUnits = BigInt(
      Math.floor(activity.amount * 10 ** TOKEN_DECIMALS["USDC"])
    );
    const deposit = await depositToSelfClaimable(burnerKeypair, baseUnits);

    // Step 5: best-effort sweep leftover SOL back to sponsor.
    await sweepBurnerSol(connection, burnerKeypair).catch(() => null);

    // Step 6: mark settled. tx_hash = the createUtxo signature (canonical
    // Umbra deposit signature).
    await updateActivityStatus(activityId, "settled", {
      tx_hash: deposit.createUtxoSignature,
      deposit_tx_hash: depositTx,
      provider_id: "umbra",
    });

    // Build claim link from the activity ID.
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://swish.cash";
    const claimLink = `${baseUrl}/c/${activityId}`;

    return {
      activityId,
      depositTx,
      withdrawTx: deposit.createUtxoSignature,
      claimLink,
      burnerAddress: activity.burner_address,
    };
  } catch (err) {
    console.error("Umbra send_claim submit failed:", err);
    await updateActivityStatus(activityId, "cancelled");
    throw err;
  }
}
