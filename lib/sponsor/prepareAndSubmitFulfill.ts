/**
 * Prepare and Submit Fulfill - Split flow for request fulfillment
 *
 * Prepare phase:
 * 1. Build unsigned deposit tx (using session signature for encryption)
 * 2. Estimate network fees
 * 3. Return unsigned tx for user to sign
 *
 * Submit phase:
 * 1. Receive signed deposit tx
 * 2. Submit deposit to relayer
 * 3. Wait for indexer, withdraw to receiver (requester)
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
  getActivity,
  updateActivityStatus,
} from "../database";
import { getCircuitBasePathCached } from "../utils/circuitPath";

// Base fee per signature in Solana
const BASE_FEE_LAMPORTS = 5000;

// Storage for UTXO cache
const storage = new LocalStorage(path.join(process.cwd(), "cache"));

// ============================================================================
// PREPARE PHASE
// ============================================================================

export interface PrepareFulfillParams {
  connection: Connection;
  activityId: string;
  payerPublicKey: PublicKey;
  sessionSignature: Uint8Array;
}

export interface PrepareFulfillResult {
  activityId: string;
  unsignedDepositTx: string;
  lastValidBlockHeight: number;
  estimatedFeeLamports: number;
  estimatedFeeSOL: number;
  // Request details for UI confirmation
  amount: number;
  token: TokenType;
  receiverAddress: string;
}

/**
 * Prepare fulfill transaction for user to sign.
 * User pays their own gas fees.
 */
export async function prepareFulfill(
  params: PrepareFulfillParams
): Promise<PrepareFulfillResult> {
  const {
    connection,
    activityId,
    payerPublicKey,
    sessionSignature,
  } = params;

  console.log("=== Prepare Fulfill ===");
  console.log("Activity:", activityId);
  console.log("Payer:", payerPublicKey.toBase58());

  // Fetch activity from database
  const activity = await getActivity(activityId);
  if (!activity) {
    throw new Error("Request not found");
  }

  if (activity.type !== "request") {
    throw new Error("Not a payment request");
  }

  if (activity.status !== "open") {
    throw new Error("Request already fulfilled or cancelled");
  }

  // Verify payer if restricted
  if (activity.sender_address) {
    if (activity.sender_address !== payerPublicKey.toBase58()) {
      throw new Error("Not authorized to fulfill this request");
    }
  }

  // Get request details
  if (!activity.receiver_address) {
    throw new Error("Request missing receiver address");
  }

  const receiverAddress = activity.receiver_address;
  const amount = activity.amount;

  // Determine token
  let token: TokenType = "USDC";
  if (activity.token_address === TOKEN_MINTS.SOL.toBase58()) {
    token = "SOL";
  } else if (activity.token_address === TOKEN_MINTS.USDT.toBase58()) {
    token = "USDT";
  }

  const baseUnits = Math.floor(amount * 1_000_000);

  console.log("Receiver:", receiverAddress);
  console.log("Amount:", amount, token);

  // Step 1: Build deposit transaction
  console.log("\n[1/2] Building deposit transaction...");

  const { transaction: depositTx, lastValidBlockHeight } = await buildDepositSPLTransaction({
    connection,
    userPublicKey: payerPublicKey,
    sessionSignature,
    baseUnits,
    token,
    storage,
  });

  console.log("Deposit tx built (unsigned)");

  // Step 2: Estimate network fee
  console.log("\n[2/2] Estimating network fee...");

  const feeCalculator = await connection.getFeeForMessage(depositTx.message, "confirmed");
  const estimatedFeeLamports = feeCalculator.value ?? BASE_FEE_LAMPORTS;
  const estimatedFeeSOL = estimatedFeeLamports / 1_000_000_000;

  console.log("Estimated fee:", estimatedFeeLamports, "lamports (", estimatedFeeSOL, "SOL)");

  // Check if user has enough SOL for fees
  const userBalance = await connection.getBalance(payerPublicKey);
  console.log("Payer SOL balance:", userBalance, "lamports");

  if (userBalance < estimatedFeeLamports) {
    throw new Error(`Insufficient SOL for network fees. Need ${estimatedFeeLamports} lamports (~${estimatedFeeSOL.toFixed(6)} SOL), have ${userBalance} lamports`);
  }

  // Serialize transaction for frontend
  const unsignedDepositTx = Buffer.from(depositTx.serialize()).toString("base64");

  return {
    activityId,
    unsignedDepositTx,
    lastValidBlockHeight,
    estimatedFeeLamports,
    estimatedFeeSOL,
    amount,
    token,
    receiverAddress,
  };
}

// ============================================================================
// SUBMIT PHASE
// ============================================================================

export interface SubmitFulfillParams {
  connection: Connection;
  signedDepositTx: string;
  sessionSignature: Uint8Array;
  activityId: string;
  payerPublicKey: PublicKey;
  lastValidBlockHeight?: number;
}

export interface SubmitFulfillResult {
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
 * Submit signed deposit transaction and complete the fulfill flow.
 */
export async function submitFulfill(
  params: SubmitFulfillParams
): Promise<SubmitFulfillResult> {
  const {
    connection,
    signedDepositTx,
    sessionSignature,
    activityId,
    payerPublicKey,
    lastValidBlockHeight,
  } = params;

  console.log("=== Submit Fulfill ===");
  console.log("Activity:", activityId);
  console.log("Payer:", payerPublicKey.toBase58());

  // Check if transaction is still valid (if lastValidBlockHeight provided)
  if (lastValidBlockHeight) {
    const currentBlockHeight = await connection.getBlockHeight("confirmed");
    if (currentBlockHeight > lastValidBlockHeight) {
      throw new Error("Transaction expired. Please prepare again.");
    }
    console.log(`Block height check: ${currentBlockHeight} <= ${lastValidBlockHeight} ✓`);
  }

  // Fetch activity to get details
  const activity = await getActivity(activityId);
  if (!activity) {
    throw new Error("Request not found");
  }

  if (activity.status !== "open") {
    throw new Error("Request already fulfilled or cancelled");
  }

  if (!activity.receiver_address) {
    throw new Error("Request missing receiver address");
  }

  const receiverAddress = activity.receiver_address;
  const amount = activity.amount;
  const baseUnits = Math.floor(amount * 1_000_000);

  // Determine token
  let token: TokenType = "USDC";
  if (activity.token_address === TOKEN_MINTS.SOL.toBase58()) {
    token = "SOL";
  } else if (activity.token_address === TOKEN_MINTS.USDT.toBase58()) {
    token = "USDT";
  }

  const mintAddress = TOKEN_MINTS[token];

  try {
    // Step 1: Submit deposit to relayer
    console.log("\n[1/3] Submitting deposit to relayer...");

    const depositSig = await relayDepositToIndexer(
      signedDepositTx,
      payerPublicKey.toBase58(),
      mintAddress.toBase58()
    );
    console.log("Deposit tx:", depositSig);

    // Step 2: Wait for indexer
    console.log("\n[2/3] Waiting for indexer (15s)...");
    await new Promise((r) => setTimeout(r, 15000));

    // Step 3: Withdraw to receiver (requester)
    console.log("\n[3/3] Withdrawing to receiver...");

    const encryptionService = new EncryptionService();
    encryptionService.deriveEncryptionKeyFromSignature(sessionSignature);

    const lightWasm = await WasmFactory.getInstance();

    const withdrawResult = await withdrawSPL({
      mintAddress,
      lightWasm,
      base_units: baseUnits,
      connection,
      encryptionService,
      publicKey: payerPublicKey,
      recipient: new PublicKey(receiverAddress),
      keyBasePath: getCircuitBasePathCached(),
      storage,
    });

    const withdrawTx = withdrawResult.tx;
    console.log("Withdraw tx:", withdrawTx);

    // Update activity status and add sender_address
    // provider_id stamped now that settlement happened. Hardcoded to "privacy-cash"
    // here; once PR 3 wraps the fulfill flow in the registry, the provider will
    // thread its own id through.
    await updateActivityStatus(activity.id, "settled", {
      tx_hash: withdrawTx,
      sender_address: payerPublicKey.toBase58(),
      provider_id: "privacy-cash",
    });

    console.log("Activity updated: settled");

    return {
      activityId,
      depositTx: depositSig,
      withdrawTx,
    };
  } catch (error) {
    console.error("Submit fulfill failed:", error);
    throw error;
  }
}
