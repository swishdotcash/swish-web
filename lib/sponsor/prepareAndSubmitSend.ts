/**
 * Prepare and Submit Send - Split flow for UI integration
 *
 * Prepare phase:
 * 1. Build unsigned deposit tx (using session signature for encryption)
 * 2. Estimate network fees
 * 3. Return unsigned tx for user to sign
 *
 * Submit phase:
 * 1. Receive signed deposit tx
 * 2. Submit deposit to relayer
 * 3. Wait for indexer, withdraw to receiver
 *
 * Note: User pays their own gas fees (no sponsor funding/sweep)
 */

import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import * as path from "path";
import { LocalStorage } from "node-localstorage";
import { WasmFactory } from "@lightprotocol/hasher.rs";
import { EncryptionService } from "privacycash/dist/utils/encryption.js";
import { RELAYER_API_URL } from "privacycash/dist/utils/constants.js";
import { withdrawSPL } from "privacycash/dist/withdrawSPL.js";

import { buildDepositSPLTransaction } from "./depositBuilder";
import { TOKEN_MINTS, TokenType } from "../privacycash/tokens";
import {
  createActivity,
  updateActivityStatus,
} from "../database";
import { getCircuitBasePathCached } from "../utils/circuitPath";

// Base fee per signature in Solana
const BASE_FEE_LAMPORTS = 5000;

// Session message that user signs to derive encryption keys
export const SESSION_MESSAGE = "Privacy Money account sign in";

// Storage for UTXO cache
const storage = new LocalStorage(path.join(process.cwd(), "cache"));

// ============================================================================
// PREPARE PHASE
// ============================================================================

export interface PrepareSendParams {
  connection: Connection;
  senderPublicKey: PublicKey;
  sessionSignature: Uint8Array; // 64-byte signature
  receiverAddress: string;
  amount: number;
  token: TokenType;
  message?: string;
}

export interface PrepareSendResult {
  activityId: string;
  unsignedDepositTx: string; // base64 serialized
  lastValidBlockHeight: number; // For checking if tx is still valid
  estimatedFeeLamports: number; // Network fee in lamports
  estimatedFeeSOL: number; // Network fee in SOL
}

/**
 * Prepare send transaction for user to sign.
 * User pays their own gas fees.
 */
export async function prepareSend(
  params: PrepareSendParams
): Promise<PrepareSendResult> {
  const {
    connection,
    senderPublicKey,
    sessionSignature,
    receiverAddress,
    amount,
    token,
    message,
  } = params;

  const baseUnits = Math.floor(amount * 1_000_000);

  console.log("=== Prepare Send ===");
  console.log("Sender:", senderPublicKey.toBase58());
  console.log("Receiver:", receiverAddress);
  console.log("Amount:", amount, token);

  // Create activity record
  console.log("\n[1/3] Creating activity record...");
  const activity = await createActivity({
    type: "send",
    sender_address: senderPublicKey.toBase58(),
    receiver_address: receiverAddress,
    amount,
    token_address: TOKEN_MINTS[token].toBase58(),
    status: "open",
    message: message || null,
    tx_hash: null,
  });
  console.log("Activity created:", activity.id);

  // Step 2: Build deposit transaction (unsigned)
  console.log("\n[2/3] Building deposit transaction...");

  const { transaction: depositTx, lastValidBlockHeight } = await buildDepositSPLTransaction({
    connection,
    userPublicKey: senderPublicKey,
    sessionSignature,
    baseUnits,
    token,
    storage,
  });

  console.log("Deposit tx built (unsigned)");

  // Step 3: Estimate network fee
  console.log("\n[3/3] Estimating network fee...");

  // Get fee from the transaction message
  const feeCalculator = await connection.getFeeForMessage(depositTx.message, "confirmed");
  const estimatedFeeLamports = feeCalculator.value ?? BASE_FEE_LAMPORTS;
  const estimatedFeeSOL = estimatedFeeLamports / 1_000_000_000;

  console.log("Estimated fee:", estimatedFeeLamports, "lamports (", estimatedFeeSOL, "SOL)");

  // Check if user has enough SOL for fees
  const userBalance = await connection.getBalance(senderPublicKey);
  console.log("User SOL balance:", userBalance, "lamports");

  if (userBalance < estimatedFeeLamports) {
    await updateActivityStatus(activity.id, "cancelled");
    throw new Error(`Insufficient SOL for network fees. Need ${estimatedFeeLamports} lamports (~${estimatedFeeSOL.toFixed(6)} SOL), have ${userBalance} lamports`);
  }

  // Serialize transaction for frontend
  const unsignedDepositTx = Buffer.from(depositTx.serialize()).toString("base64");

  return {
    activityId: activity.id,
    unsignedDepositTx,
    lastValidBlockHeight,
    estimatedFeeLamports,
    estimatedFeeSOL,
  };
}

// ============================================================================
// SUBMIT PHASE
// ============================================================================

export interface SubmitSendParams {
  connection: Connection;
  signedDepositTx: string; // base64 serialized
  sessionSignature: Uint8Array; // 64-byte signature for deriving keys
  activityId: string;
  senderPublicKey: PublicKey;
  receiverAddress: string;
  amount: number;
  token: TokenType;
  lastValidBlockHeight?: number; // Optional: for checking tx validity
  providerId: string; // Stamped on the activity row at settlement
}

export interface SubmitSendResult {
  activityId: string;
  depositTx: string;
  withdrawTx: string;
}

/**
 * Relay signed deposit transaction to indexer
 */
async function relayDepositToIndexer(
  signedTransaction: string,
  senderAddress: string,
  mintAddress: string
): Promise<string> {
  const response = await fetch(`${RELAYER_API_URL}/deposit/spl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      signedTransaction,
      senderAddress,
      mintAddress,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Relay failed: ${text}`);
  }

  const result = (await response.json()) as { signature: string };
  return result.signature;
}

/**
 * Submit signed deposit transaction and complete the send flow.
 */
export async function submitSend(
  params: SubmitSendParams
): Promise<SubmitSendResult> {
  const {
    connection,
    signedDepositTx,
    sessionSignature,
    activityId,
    senderPublicKey,
    receiverAddress,
    amount,
    token,
    lastValidBlockHeight,
    providerId,
  } = params;

  const baseUnits = Math.floor(amount * 1_000_000);
  const mintAddress = TOKEN_MINTS[token];

  console.log("=== Submit Send ===");
  console.log("Activity:", activityId);
  console.log("Sender:", senderPublicKey.toBase58());

  // Check if transaction is still valid (if lastValidBlockHeight provided)
  if (lastValidBlockHeight) {
    const currentBlockHeight = await connection.getBlockHeight("confirmed");
    if (currentBlockHeight > lastValidBlockHeight) {
      throw new Error("Transaction expired. Please prepare again.");
    }
    console.log(`Block height check: ${currentBlockHeight} <= ${lastValidBlockHeight} ✓`);
  }

  try {
    // Step 1: Submit deposit to relayer
    console.log("\n[1/3] Submitting deposit to relayer...");

    const depositSig = await relayDepositToIndexer(
      signedDepositTx,
      senderPublicKey.toBase58(),
      mintAddress.toBase58()
    );
    console.log("Deposit tx:", depositSig);

    // Step 2: Wait for indexer
    console.log("\n[2/3] Waiting for indexer (15s)...");
    await new Promise((r) => setTimeout(r, 15000));

    // Step 3: Withdraw to receiver
    console.log("\n[3/3] Withdrawing to receiver...");

    // Derive encryption keys from session signature
    const encryptionService = new EncryptionService();
    encryptionService.deriveEncryptionKeyFromSignature(sessionSignature);

    // Get LightWasm instance
    const lightWasm = await WasmFactory.getInstance();

    // Withdraw to receiver using the derived keys
    const withdrawResult = await withdrawSPL({
      mintAddress,
      lightWasm,
      base_units: baseUnits,
      connection,
      encryptionService,
      publicKey: senderPublicKey,
      recipient: new PublicKey(receiverAddress),
      keyBasePath: getCircuitBasePathCached(),
      storage,
    });

    const withdrawTx = withdrawResult.tx;
    console.log("Withdraw tx:", withdrawTx);

    // Update activity status — stamp provider_id now that settlement has happened
    await updateActivityStatus(activityId, "settled", {
      tx_hash: withdrawTx,
      provider_id: providerId,
    });
    console.log("Activity updated: settled");

    return {
      activityId,
      depositTx: depositSig,
      withdrawTx,
    };
  } catch (error) {
    // Mark activity as failed
    await updateActivityStatus(activityId, "cancelled");
    console.error("Submit failed:", error);
    throw error;
  }
}
