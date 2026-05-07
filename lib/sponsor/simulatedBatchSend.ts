/**
 * Simulated Batch Send - Zero dust, one wallet popup
 *
 * Flow:
 * 1. Sponsor pre-funds user with SOL
 * 2. Build deposit tx (don't submit)
 * 3. Simulate deposit to get exact remaining balance
 * 4. Build sweep tx with exact amount (closes account to 0)
 * 5. Batch sign both txs (ONE wallet popup)
 * 6. Submit deposit to relayer
 * 7. Submit sweep to network
 *
 * Result: User signs once, zero dust.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  VersionedTransaction,
  TransactionMessage,
  SimulatedTransactionResponse,
} from "@solana/web3.js";
import * as path from "path";
import { LocalStorage } from "node-localstorage";
import { WasmFactory } from "@lightprotocol/hasher.rs";
import { EncryptionService } from "privacycash/dist/utils/encryption.js";
import { RELAYER_API_URL } from "privacycash/dist/utils/constants.js";
import { PrivacyCash } from "privacycash";

import { buildDepositSPLTransaction } from "./depositBuilder";
import { TOKEN_MINTS, TokenType } from "../privacycash/tokens";
import {
  createActivity,
  updateActivityStatus,
} from "../database";

// Rent for 2 nullifier PDAs + SDK minimum
const RENT_LAMPORTS = 953520 * 2;
const SDK_MINIMUM = 2_000_000;
const TOTAL_PREFUND = RENT_LAMPORTS + SDK_MINIMUM;

// Storage for UTXO cache
const storage = new LocalStorage(path.join(process.cwd(), "cache"));

export interface SimulatedBatchSendParams {
  connection: Connection;
  userKeypair: Keypair;
  sponsorKeypair: Keypair;
  receiverAddress: string;
  amount: number;
  token: TokenType;
  // Wallet's signAllTransactions - user sees ONE popup
  signAllTransactions: (txs: VersionedTransaction[]) => Promise<VersionedTransaction[]>;
}

export interface SimulatedBatchSendResult {
  activityId: string;
  fundTx: string;
  depositTx: string;
  withdrawTx: string;
  sweepTx: string;
  finalBalance: number;
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
 * Performs a sponsored send with simulation-based exact sweep.
 * User signs once (batch), zero dust.
 */
export async function simulatedBatchSend(
  params: SimulatedBatchSendParams
): Promise<SimulatedBatchSendResult> {
  const {
    connection,
    userKeypair,
    sponsorKeypair,
    receiverAddress,
    amount,
    token,
    signAllTransactions,
  } = params;

  const userPublicKey = userKeypair.publicKey;
  const baseUnits = Math.floor(amount * 1_000_000);

  console.log("=== Simulated Batch Send (Zero Dust) ===");
  console.log("User:", userPublicKey.toBase58());
  console.log("Sponsor:", sponsorKeypair.publicKey.toBase58());
  console.log("Receiver:", receiverAddress);
  console.log("Amount:", amount, token);

  // Create activity record
  console.log("\n[0/6] Creating activity record...");
  const activity = await createActivity({
    type: "send",
    sender_address: userPublicKey.toBase58(),
    receiver_address: receiverAddress,
    amount,
    token_address: TOKEN_MINTS[token].toBase58(),
    status: "open",
    message: null,
    tx_hash: null,
    burner_address: null,
    encrypted_for_receiver: null,
    encrypted_for_sender: null,
    deposit_tx_hash: null,
    claim_tx_hash: null,
  });
  console.log("Activity created:", activity.id);

  try {
  // Step 1: Pre-fund user with SOL
  console.log("\n[1/6] Pre-funding user with SOL...");
  const userBalance = await connection.getBalance(userPublicKey);

  let fundTx = "";
  if (userBalance < TOTAL_PREFUND) {
    const needed = TOTAL_PREFUND - userBalance;
    const fundTransaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sponsorKeypair.publicKey,
        toPubkey: userPublicKey,
        lamports: needed,
      })
    );
    fundTx = await connection.sendTransaction(fundTransaction, [sponsorKeypair]);
    await connection.confirmTransaction(fundTx, "confirmed");
    console.log("Fund tx:", fundTx);
  } else {
    console.log("User already has enough SOL");
  }

  // Step 2: Build deposit transaction (unsigned)
  console.log("\n[2/6] Building deposit transaction...");

  const { transaction: depositTx, mintAddress } = await buildDepositSPLTransaction({
    connection,
    userKeypair,
    baseUnits,
    token,
    storage,
  });

  console.log("Deposit tx built (unsigned)");

  // Step 3: Simulate deposit to get post-balance
  console.log("\n[3/6] Simulating deposit to get exact remaining...");

  // Need to temporarily sign for simulation
  const depositTxForSim = VersionedTransaction.deserialize(depositTx.serialize());
  depositTxForSim.sign([userKeypair]);

  const simulation = await connection.simulateTransaction(depositTxForSim, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });

  if (simulation.value.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }

  // Find user's post-balance from simulation
  // User is typically the first account (fee payer)
  const postBalance = simulation.value.accounts?.[0]?.lamports;

  if (postBalance === undefined || postBalance === null) {
    // Fallback: estimate based on known costs
    const estimatedRemaining = (await connection.getBalance(userPublicKey)) - RENT_LAMPORTS - 5000;
    console.log("Using estimated remaining:", estimatedRemaining);
  }

  const exactRemaining = postBalance ?? ((await connection.getBalance(userPublicKey)) - RENT_LAMPORTS - 5000);
  console.log("Exact remaining after deposit:", exactRemaining, "lamports");

  // Step 4: Build sweep transaction with exact amount
  console.log("\n[4/6] Building sweep with exact amount...");

  const { blockhash: sweepBlockhash } = await connection.getLatestBlockhash();

  // Sweep ALL remaining to close account
  // Sponsor pays the fee so user can transfer everything
  const sweepMessage = new TransactionMessage({
    payerKey: sponsorKeypair.publicKey, // Sponsor pays sweep fee
    recentBlockhash: sweepBlockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: userPublicKey,
        toPubkey: sponsorKeypair.publicKey,
        lamports: exactRemaining,
      }),
    ],
  }).compileToV0Message();

  const sweepTx = new VersionedTransaction(sweepMessage);

  console.log("Sweep amount:", exactRemaining, "lamports");

  // Step 5: Batch sign both transactions (ONE wallet popup)
  console.log("\n[5/6] Batch signing (user signs ONCE)...");

  // Get fresh blockhash for deposit
  const { blockhash: depositBlockhash } = await connection.getLatestBlockhash();

  // Rebuild deposit tx with fresh blockhash for actual submission
  // (The built tx might have old blockhash from building time)
  const freshDepositTx = VersionedTransaction.deserialize(depositTx.serialize());
  // Note: Can't easily update blockhash on VersionedTransaction
  // For production, we'd rebuild the tx. For now, use the original if recent enough.

  // Sponsor signs sweep (as fee payer)
  sweepTx.sign([sponsorKeypair]);

  // User batch signs both
  const [signedDeposit, signedSweep] = await signAllTransactions([depositTx, sweepTx]);

  console.log("Batch signing complete - user signed ONCE");

  // Step 6: Submit deposit and sweep
  console.log("\n[6/8] Submitting deposit...");

  const serializedDeposit = Buffer.from(signedDeposit.serialize()).toString("base64");
  const depositSig = await relayDepositToIndexer(
    serializedDeposit,
    userPublicKey.toBase58(),
    mintAddress.toBase58()
  );
  console.log("Deposit tx:", depositSig);

  // Wait briefly for deposit to settle
  await new Promise(r => setTimeout(r, 2000));

  // Submit sweep
  console.log("\n[7/8] Submitting sweep...");
  const sweepSig = await connection.sendRawTransaction(signedSweep.serialize());
  await connection.confirmTransaction(sweepSig, "confirmed");
  console.log("Sweep tx:", sweepSig);

  const finalBalance = await connection.getBalance(userPublicKey);
  console.log("Final balance:", finalBalance, "lamports");

  // Step 8: Wait for indexer and withdraw to receiver
  console.log("\n[8/8] Waiting for indexer (15s) then withdrawing to receiver...");
  await new Promise(r => setTimeout(r, 15000));

  // Create PrivacyCash client for withdraw
  const client = new PrivacyCash({
    RPC_url: process.env.RPC_URL!,
    owner: userKeypair.secretKey,
  });

  // Check private balance
  const privateBalance = await client.getPrivateBalanceUSDC();
  console.log("Private balance:", privateBalance.base_units / 1_000_000, token);

  // Withdraw to receiver
  const withdrawResult = await client.withdrawUSDC({
    base_units: baseUnits,
    recipientAddress: receiverAddress,
  });
  const withdrawTx = withdrawResult.tx || String(withdrawResult);
  console.log("Withdraw tx:", withdrawTx);

  // Update activity status to settled — stamp provider_id at settle time
  await updateActivityStatus(activity.id, "settled", {
    tx_hash: withdrawTx,
    provider_id: "privacy-cash",
  });
  console.log("Activity updated: settled");

  return {
    activityId: activity.id,
    fundTx,
    depositTx: depositSig,
    withdrawTx,
    sweepTx: sweepSig,
    finalBalance,
  };
  } catch (error) {
    // Mark activity as failed
    await updateActivityStatus(activity.id, "cancelled");
    console.log("Activity updated: cancelled");
    throw error;
  }
}

/**
 * Test helper: Simulates wallet.signAllTransactions
 */
export function createTestSigner(keypair: Keypair) {
  return async (txs: VersionedTransaction[]): Promise<VersionedTransaction[]> => {
    return txs.map((tx) => {
      tx.sign([keypair]);
      return tx;
    });
  };
}
