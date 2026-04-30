/**
 * Umbra direct Send + Request fulfill — prepare/submit pipeline.
 *
 * Both flows share the burner pattern:
 *   1. Prepare: server creates fresh burner, builds sender→burner ATA
 *      transfer, returns unsigned tx for user to sign
 *   2. Submit: user-signed transfer lands in burner ATA → server runs
 *      Umbra deposit as burner with UTXO locked to recipient's commitment
 *
 * Direct Send vs Request fulfill differ only in:
 *   - Where the recipient address comes from (picker vs request row)
 *   - Activity type / which row is updated
 *
 * See [Umbra architecture decision](memory/project_umbra_architecture_decision.md).
 */

import { Connection, PublicKey } from "@solana/web3.js";

import { TOKEN_MINTS, TokenType } from "../privacycash/tokens";
import {
  createActivity,
  getActivity,
  updateActivityStatus,
} from "../database";
import {
  buildSenderToBurnerTransferTx,
  createBurner,
  decryptBurnerForServer,
  depositToReceiverClaimable,
  encryptBurnerForServer,
  ensureBurnerSol,
  isAddressRegisteredOnUmbra,
  submitSenderToBurnerTransfer,
  sweepBurnerSol,
} from "./umbraBurner";
import { Keypair } from "@solana/web3.js";

// USDC has 6 decimals.
const TOKEN_DECIMALS: Record<TokenType, number> = {
  USDC: 6,
  USDT: 6,
  SOL: 9,
};

function toBaseUnits(amount: number, token: TokenType): bigint {
  return BigInt(Math.floor(amount * 10 ** TOKEN_DECIMALS[token]));
}

// ============================================================
// Direct Send
// ============================================================

export interface PrepareUmbraSendParams {
  connection: Connection;
  senderPublicKey: PublicKey;
  receiverAddress: string;
  amount: number;
  token: TokenType;
  message?: string;
}

export interface PrepareUmbraSendResult {
  activityId: string;
  unsignedDepositTx: string;
  lastValidBlockHeight: number;
  estimatedFeeLamports: number;
  estimatedFeeSOL: number;
  // Server-side bookkeeping returned for submit() — burner privkey
  // ciphertext (server can decrypt to resume) + burner address.
  providerContext: {
    burnerSecretKeyCiphertext: string;
    burnerAddress: string;
  };
}

export async function prepareUmbraSend(
  params: PrepareUmbraSendParams
): Promise<PrepareUmbraSendResult> {
  const {
    connection,
    senderPublicKey,
    receiverAddress,
    amount,
    token,
    message,
  } = params;

  // Pre-flight: recipient must be registered on Umbra.
  const registered = await isAddressRegisteredOnUmbra(receiverAddress);
  if (!registered) {
    throw new Error(
      "Recipient not registered on Umbra — switch to Privacy Cash or MagicBlock"
    );
  }

  const baseUnits = toBaseUnits(amount, token);
  const mint = TOKEN_MINTS[token];

  // Create fresh burner per send.
  const burner = createBurner();

  // Server-encrypt burner privkey so we can resume on crash. NOT
  // user-bound — direct Send doesn't have a user-facing reclaim flow
  // in the happy path. Server holds the key in memory through the
  // submit handler; ciphertext is the crash-recovery backstop.
  const encrypted = encryptBurnerForServer(burner.keypair.secretKey);

  // Build the unsigned tx the SENDER signs: sender's USDC ATA → burner
  // ATA. Sponsor is fee payer (user signs token authority only).
  const transfer = await buildSenderToBurnerTransferTx({
    connection,
    senderPubkey: senderPublicKey,
    burnerPubkey: burner.keypair.publicKey,
    amountBaseUnits: baseUnits,
    mint,
  });

  // Persist the activity row. Burner address + encrypted privkey live
  // here so we can recover on retry. provider_id stamped at create
  // because we need it on submit to dispatch back to this provider.
  const activity = await createActivity({
    type: "send",
    sender_address: senderPublicKey.toBase58(),
    receiver_address: receiverAddress,
    amount,
    token_address: mint.toBase58(),
    status: "open",
    message: message || null,
    tx_hash: null,
    burner_address: burner.address,
    encrypted_for_sender: {
      ciphertext: encrypted.ciphertext,
      iv: "",
      authTag: "",
      // Schema is loose — we use the existing column (designed for
      // session-sig encrypted blobs) to also hold our server-encrypted
      // payload. The `algorithm` discriminator distinguishes:
      // server-encrypted (aes-256-gcm) vs session-sig encrypted (per
      // PC's existing scheme).
      algorithm: encrypted.algorithm,
    } as any,
    provider_id: "umbra",
  });

  return {
    activityId: activity.id,
    unsignedDepositTx: transfer.unsignedTxBase64,
    lastValidBlockHeight: transfer.lastValidBlockHeight,
    // SPL transfer base fee (sponsor pays, but we surface for UI parity)
    estimatedFeeLamports: 5000,
    estimatedFeeSOL: 0.000005,
    providerContext: {
      burnerSecretKeyCiphertext: encrypted.ciphertext,
      burnerAddress: burner.address,
    },
  };
}

export interface SubmitUmbraSendParams {
  connection: Connection;
  signedDepositTx: string;
  activityId: string;
  senderPublicKey: PublicKey;
  receiverAddress: string;
  amount: number;
  token: TokenType;
  lastValidBlockHeight?: number;
}

export interface SubmitUmbraSendResult {
  activityId: string;
  depositTx: string; // sender→burner SPL transfer
  withdrawTx: string; // Umbra createUtxo signature
  burnerAddress: string;
}

export async function submitUmbraSend(
  params: SubmitUmbraSendParams
): Promise<SubmitUmbraSendResult> {
  const {
    connection,
    signedDepositTx,
    activityId,
    senderPublicKey,
    receiverAddress,
  } = params;

  const activity = await getActivity(activityId);
  if (!activity) throw new Error("Activity not found");
  if (activity.type !== "send") throw new Error("Not a send activity");
  if (activity.status !== "open") {
    throw new Error(`Activity is already ${activity.status}`);
  }
  if (activity.sender_address !== senderPublicKey.toBase58()) {
    throw new Error("Not authorized to submit this send");
  }
  if (!activity.burner_address || !activity.encrypted_for_sender) {
    throw new Error("Activity missing burner data");
  }

  // Recover burner privkey from the server-encrypted ciphertext stored
  // at prepare time.
  const ciphertext = (activity.encrypted_for_sender as any).ciphertext;
  if (!ciphertext) {
    throw new Error("Activity missing encrypted burner key");
  }
  const burnerSecretKey = decryptBurnerForServer({
    ciphertext,
    algorithm: "aes-256-gcm",
  });
  const burnerKeypair = Keypair.fromSecretKey(burnerSecretKey);
  if (burnerKeypair.publicKey.toBase58() !== activity.burner_address) {
    throw new Error("Burner key mismatch");
  }

  // Move to processing — guards against double-submit and signals an
  // in-flight Umbra deposit.
  await updateActivityStatus(activityId, "processing");

  try {
    // Step 1: Submit sender→burner SPL transfer. User-signed; sponsor
    // is fee payer.
    const depositTx = await submitSenderToBurnerTransfer(
      connection,
      signedDepositTx,
      params.lastValidBlockHeight ?? 0
    );

    // Step 2: Ensure burner has SOL for the deposit txs.
    await ensureBurnerSol(connection, burnerKeypair.publicKey);

    // Step 3: Burner deposits USDC into Umbra pool with UTXO locked to
    // recipient's commitment. Burner pays SOL fees from the budget.
    //
    // NOTE: burner does NOT register on Umbra. Per the protocol, the
    // depositor (sender) does not need an EncryptedUserAccount PDA —
    // the on-chain program only verifies the RECEIVER's registered
    // commitment. Skipping registration:
    //   - Saves ~0.047 SOL per send (otherwise locked in PDA rent forever)
    //   - Eliminates one ZK prover step (faster, more reliable)
    const deposit = await depositToReceiverClaimable(
      burnerKeypair,
      BigInt(Math.floor(params.amount * 10 ** TOKEN_DECIMALS[params.token])),
      receiverAddress
    );

    // Step 5: Sweep remaining burner SOL back to sponsor (best effort).
    await sweepBurnerSol(connection, burnerKeypair);

    // Step 6: Mark settled. Stamp the deposit tx (Umbra UTXO creation)
    // as the canonical "settlement" tx_hash.
    await updateActivityStatus(activityId, "settled", {
      tx_hash: depositTx,
      provider_id: "umbra",
    });

    return {
      activityId,
      depositTx,
      withdrawTx: deposit.createUtxoSignature,
      burnerAddress: activity.burner_address,
    };
  } catch (err) {
    // On any failure, mark cancelled so the row doesn't sit in
    // processing forever. The encrypted burner key + USDC in burner
    // ATA are recoverable via manual ops. (Real "auto-resume on
    // server crash" is implicit — server processes pick up where they
    // left off because the ciphertext stays on the row.)
    console.error("Umbra send submit failed:", err);
    await updateActivityStatus(activityId, "cancelled");
    throw err;
  }
}

// ============================================================
// Request fulfill
// ============================================================

export interface PrepareUmbraFulfillParams {
  connection: Connection;
  activityId: string;
  payerPublicKey: PublicKey;
}

export interface PrepareUmbraFulfillResult {
  activityId: string;
  unsignedDepositTx: string;
  lastValidBlockHeight: number;
  estimatedFeeLamports: number;
  estimatedFeeSOL: number;
  amount: number;
  token: TokenType;
  receiverAddress: string;
  providerContext: {
    burnerSecretKeyCiphertext: string;
    burnerAddress: string;
  };
}

export async function prepareUmbraFulfill(
  params: PrepareUmbraFulfillParams
): Promise<PrepareUmbraFulfillResult> {
  const { connection, activityId, payerPublicKey } = params;

  const activity = await getActivity(activityId);
  if (!activity) throw new Error("Request not found");
  if (activity.type !== "request") throw new Error("Not a request");
  if (activity.status !== "open") {
    throw new Error(`Request is already ${activity.status}`);
  }

  // The REQUESTER is the recipient — they must be registered on Umbra.
  // (Router rule 2 / pre-flight: gate Umbra in the picker if not.)
  const requesterAddress = activity.sender_address; // Note: in `request`
  // type, sender_address is the requester (who created the request).
  // The fulfiller (Bob) is the payer.
  if (!requesterAddress) {
    throw new Error("Request missing requester address");
  }
  const registered = await isAddressRegisteredOnUmbra(requesterAddress);
  if (!registered) {
    throw new Error(
      "Requester not registered on Umbra — fulfill via Privacy Cash or MagicBlock"
    );
  }

  // Determine token from mint stored on activity.
  let token: TokenType = "USDC";
  if (activity.token_address === TOKEN_MINTS.SOL.toBase58()) token = "SOL";
  else if (activity.token_address === TOKEN_MINTS.USDT.toBase58())
    token = "USDT";

  const baseUnits = toBaseUnits(activity.amount, token);
  const mint = TOKEN_MINTS[token];

  const burner = createBurner();
  const encrypted = encryptBurnerForServer(burner.keypair.secretKey);

  const transfer = await buildSenderToBurnerTransferTx({
    connection,
    senderPubkey: payerPublicKey,
    burnerPubkey: burner.keypair.publicKey,
    amountBaseUnits: baseUnits,
    mint,
  });

  // Mark the activity with burner data; status stays open until submit.
  // We don't create a new row — the request row is what gets settled.
  // We persist burner_address + encrypted_for_sender on it.
  await updateActivityStatus(activityId, "open", {
    burner_address: burner.address,
    encrypted_for_sender: {
      ciphertext: encrypted.ciphertext,
      iv: "",
      authTag: "",
      algorithm: encrypted.algorithm,
    } as any,
  });

  return {
    activityId,
    unsignedDepositTx: transfer.unsignedTxBase64,
    lastValidBlockHeight: transfer.lastValidBlockHeight,
    estimatedFeeLamports: 5000,
    estimatedFeeSOL: 0.000005,
    amount: activity.amount,
    token,
    receiverAddress: requesterAddress,
    providerContext: {
      burnerSecretKeyCiphertext: encrypted.ciphertext,
      burnerAddress: burner.address,
    },
  };
}

export interface SubmitUmbraFulfillParams {
  connection: Connection;
  signedDepositTx: string;
  activityId: string;
  payerPublicKey: PublicKey;
  lastValidBlockHeight?: number;
}

export interface SubmitUmbraFulfillResult {
  activityId: string;
  depositTx: string;
  withdrawTx: string;
  burnerAddress: string;
}

export async function submitUmbraFulfill(
  params: SubmitUmbraFulfillParams
): Promise<SubmitUmbraFulfillResult> {
  const { connection, signedDepositTx, activityId, payerPublicKey } = params;

  const activity = await getActivity(activityId);
  if (!activity) throw new Error("Request not found");
  if (activity.type !== "request") throw new Error("Not a request");
  if (activity.status !== "open") {
    throw new Error(`Request is already ${activity.status}`);
  }
  if (!activity.burner_address || !activity.encrypted_for_sender) {
    throw new Error("Request missing burner data — call prepare first");
  }

  const ciphertext = (activity.encrypted_for_sender as any).ciphertext;
  if (!ciphertext) {
    throw new Error("Request missing encrypted burner key");
  }
  const burnerSecretKey = decryptBurnerForServer({
    ciphertext,
    algorithm: "aes-256-gcm",
  });
  const burnerKeypair = Keypair.fromSecretKey(burnerSecretKey);

  await updateActivityStatus(activityId, "processing");

  let token: TokenType = "USDC";
  if (activity.token_address === TOKEN_MINTS.SOL.toBase58()) token = "SOL";
  else if (activity.token_address === TOKEN_MINTS.USDT.toBase58())
    token = "USDT";

  const requesterAddress = activity.sender_address!;

  try {
    const depositTx = await submitSenderToBurnerTransfer(
      connection,
      signedDepositTx,
      params.lastValidBlockHeight ?? 0
    );

    await ensureBurnerSol(connection, burnerKeypair.publicKey);
    // No registration — sender doesn't need an EncryptedUserAccount PDA
    // for receiver-claimable deposits. See note in submitUmbraSend.
    const deposit = await depositToReceiverClaimable(
      burnerKeypair,
      toBaseUnits(activity.amount, token),
      requesterAddress
    );
    await sweepBurnerSol(connection, burnerKeypair);

    await updateActivityStatus(activityId, "settled", {
      tx_hash: depositTx,
      provider_id: "umbra",
      receiver_address: payerPublicKey.toBase58(), // record fulfiller
    });

    return {
      activityId,
      depositTx,
      withdrawTx: deposit.createUtxoSignature,
      burnerAddress: activity.burner_address,
    };
  } catch (err) {
    console.error("Umbra fulfill submit failed:", err);
    await updateActivityStatus(activityId, "cancelled");
    throw err;
  }
}
