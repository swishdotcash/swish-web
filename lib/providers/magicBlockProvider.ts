/**
 * MagicBlock provider.
 *
 * All flows route base→base via MB's privately-routed transfer (TEE-vault
 * anonymity-set privacy). Recipient always lands in their mainnet ATA, no
 * unlock step required. UX-equivalent to Privacy Cash from the user's POV.
 *
 * The base→ephemeral upgrade for direct Send / Request was prototyped
 * (2026-04-29 PR 5b) and reverted: it required recipients to pay SOL gas
 * to unlock, which Twitter-login Privy embedded wallets typically don't
 * have. Marginal timing-decoupling privacy gain not worth the UX cost at
 * v1 volumes. Revisit if MB ships sponsor co-signing for ephemeral
 * withdrawals.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";

import { TOKEN_MINTS, TokenType } from "../privacycash/tokens";
import {
  claimActivity,
  createActivity,
  getActivity,
  updateActivityStatus,
} from "../database";
import {
  encryptWithPassphrase,
  encryptWithSessionSignature,
  generatePassphrase,
} from "../crypto";
import {
  claimWithPassphrase,
  reclaimWithSignature,
} from "../sponsor/prepareAndSubmitClaim";
import {
  magicBlockTransfer,
  type UnsignedTransactionResponse,
} from "../sponsor/magicBlockApi";
import type {
  ClaimInput,
  ClaimResult,
  PrepareFulfillInput,
  PrepareFulfillOutput,
  PrepareSendClaimInput,
  PrepareSendClaimOutput,
  PrepareSendInput,
  PrepareSendOutput,
  PrivacySendProvider,
  ReclaimInput,
  ReclaimResult,
  SubmitFulfillInput,
  SubmitFulfillResult,
  SubmitSendClaimInput,
  SubmitSendClaimResult,
  SubmitSendInput,
  SubmitSendResult,
} from "./types";

// USDC / USDT have 6 decimals; SOL not currently supported by the
// MB provider for v1 (would need wrapped SOL handling). PC supports
// USDC for v1 in practice, so this matches.
const TOKEN_DECIMALS: Record<TokenType, number> = {
  USDC: 6,
  USDT: 6,
  SOL: 9,
};

// Conservative SOL fee estimate. Solana base sig = 5000 lamports; ATA
// creation (when initAtasIfMissing fires for a fresh recipient) adds
// ~2.04M lamports of rent. Round up to give the UI a buffer.
const ESTIMATED_FEE_LAMPORTS = 2_500_000;

function tokenFromMintAddress(address: string | null): TokenType {
  if (address === TOKEN_MINTS.SOL.toBase58()) return "SOL";
  if (address === TOKEN_MINTS.USDT.toBase58()) return "USDT";
  return "USDC";
}

function toBaseUnits(amount: number, token: TokenType): number {
  return Math.floor(amount * 10 ** TOKEN_DECIMALS[token]);
}

/**
 * Build a private base→base MB transfer and return the unsigned tx.
 * Used by Send (sender→receiver), Request fulfill (payer→requester),
 * and Send & Claim sender-create (sender→burner).
 */
async function buildPrivateTransfer(params: {
  from: PublicKey;
  to: string;
  amount: number;
  token: TokenType;
}): Promise<UnsignedTransactionResponse> {
  const { from, to, amount, token } = params;
  const mint = TOKEN_MINTS[token].toBase58();
  // MB charges 0.1% on top of the requested amount. Request amount / 1.001
  // so MB's "requested + 0.1%" lands back at exactly the amount the sender
  // entered — the fee effectively comes out of what the recipient receives
  // (matching PC / Umbra), and a user can always send their full balance.
  // floor() keeps the debit at or just under the entered amount, never over.
  const enteredBaseUnits = toBaseUnits(amount, token);
  const baseUnits = Math.floor(enteredBaseUnits / 1.001);

  const response = await magicBlockTransfer({
    from: from.toBase58(),
    to,
    mint,
    amount: baseUnits,
    visibility: "private",
    fromBalance: "base",
    toBalance: "base",
    initAtasIfMissing: true,
  });

  if (!response.requiredSigners.includes(from.toBase58())) {
    throw new Error(
      `MagicBlock returned unexpected signers: ${response.requiredSigners.join(", ")}`
    );
  }

  return response;
}

/**
 * Submit a signed VersionedTransaction to mainnet RPC and wait for
 * confirmation against the lastValidBlockHeight returned by MB.
 */
async function submitSignedTransfer(params: {
  connection: Connection;
  signedTxBase64: string;
  lastValidBlockHeight?: number;
}): Promise<string> {
  const { connection, signedTxBase64, lastValidBlockHeight } = params;

  if (lastValidBlockHeight) {
    const currentBlockHeight = await connection.getBlockHeight("confirmed");
    if (currentBlockHeight > lastValidBlockHeight) {
      throw new Error("Transaction expired. Please prepare again.");
    }
  }

  const txBytes = Buffer.from(signedTxBase64, "base64");
  const tx = VersionedTransaction.deserialize(txBytes);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  const blockhash = tx.message.recentBlockhash;
  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash,
      lastValidBlockHeight: lastValidBlockHeight ?? (await connection.getBlockHeight("confirmed")) + 150,
    },
    "confirmed"
  );

  if (confirmation.value.err) {
    throw new Error(
      `MagicBlock transfer failed on-chain: ${JSON.stringify(confirmation.value.err)}`
    );
  }

  return signature;
}

export const magicBlockProvider: PrivacySendProvider = {
  id: "magicblock-per",
  displayName: "MagicBlock",

  // ============================================================
  // Send (direct)
  // ============================================================

  async prepare(input: PrepareSendInput): Promise<PrepareSendOutput> {
    const { connection: _connection, senderPublicKey, receiverAddress, amount, token, message } = input;

    console.log("=== MB Prepare Send ===");
    console.log("Sender:", senderPublicKey.toBase58());
    console.log("Receiver:", receiverAddress);
    console.log("Amount:", amount, token);

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

    const transfer = await buildPrivateTransfer({
      from: senderPublicKey,
      to: receiverAddress,
      amount,
      token,
    });

    return {
      activityId: activity.id,
      unsignedDepositTx: transfer.transactionBase64,
      lastValidBlockHeight: transfer.lastValidBlockHeight,
      estimatedFeeLamports: ESTIMATED_FEE_LAMPORTS,
      estimatedFeeSOL: ESTIMATED_FEE_LAMPORTS / 1_000_000_000,
    };
  },

  async submit(input: SubmitSendInput): Promise<SubmitSendResult> {
    const { connection, signedDepositTx, activityId, lastValidBlockHeight } = input;

    console.log("=== MB Submit Send ===");
    console.log("Activity:", activityId);

    try {
      const signature = await submitSignedTransfer({
        connection,
        signedTxBase64: signedDepositTx,
        lastValidBlockHeight,
      });

      await updateActivityStatus(activityId, "settled", {
        tx_hash: signature,
        provider_id: this.id,
      });

      return {
        activityId,
        depositTx: signature,
        withdrawTx: signature, // single tx for MB base→base
      };
    } catch (error) {
      await updateActivityStatus(activityId, "cancelled");
      throw error;
    }
  },

  // ============================================================
  // Request fulfill
  // ============================================================

  async prepareFulfill(input: PrepareFulfillInput): Promise<PrepareFulfillOutput> {
    const { connection: _connection, activityId, payerPublicKey } = input;

    console.log("=== MB Prepare Fulfill ===");
    console.log("Activity:", activityId);
    console.log("Payer:", payerPublicKey.toBase58());

    const activity = await getActivity(activityId);
    if (!activity) throw new Error("Request not found");
    if (activity.type !== "request") throw new Error("Not a payment request");
    if (activity.status !== "open") throw new Error("Request already fulfilled or cancelled");
    if (!activity.receiver_address) throw new Error("Request missing receiver address");

    if (activity.sender_address && activity.sender_address !== payerPublicKey.toBase58()) {
      throw new Error("Not authorized to fulfill this request");
    }

    const token = tokenFromMintAddress(activity.token_address);

    const transfer = await buildPrivateTransfer({
      from: payerPublicKey,
      to: activity.receiver_address,
      amount: activity.amount,
      token,
    });

    return {
      activityId: activity.id,
      unsignedDepositTx: transfer.transactionBase64,
      lastValidBlockHeight: transfer.lastValidBlockHeight,
      estimatedFeeLamports: ESTIMATED_FEE_LAMPORTS,
      estimatedFeeSOL: ESTIMATED_FEE_LAMPORTS / 1_000_000_000,
      amount: activity.amount,
      token,
      receiverAddress: activity.receiver_address,
    };
  },

  async submitFulfill(input: SubmitFulfillInput): Promise<SubmitFulfillResult> {
    const { connection, signedDepositTx, activityId, payerPublicKey, lastValidBlockHeight } = input;

    console.log("=== MB Submit Fulfill ===");
    console.log("Activity:", activityId);

    const activity = await getActivity(activityId);
    if (!activity) throw new Error("Request not found");
    if (activity.type !== "request") throw new Error("Not a payment request");

    try {
      const signature = await submitSignedTransfer({
        connection,
        signedTxBase64: signedDepositTx,
        lastValidBlockHeight,
      });

      await updateActivityStatus(activityId, "settled", {
        tx_hash: signature,
        sender_address: payerPublicKey.toBase58(),
        provider_id: this.id,
      });

      return {
        activityId,
        depositTx: signature,
        withdrawTx: signature,
      };
    } catch (error) {
      // Don't cancel on relay failure — the request is still valid for
      // someone else to fulfill. Same posture as PC's submitFulfill.
      throw error;
    }
  },

  // ============================================================
  // Send & Claim (hybrid burner)
  // ============================================================

  async prepareSendClaim(input: PrepareSendClaimInput): Promise<PrepareSendClaimOutput> {
    const { connection: _connection, senderPublicKey, sessionSignature, amount, token, message } = input;

    console.log("=== MB Prepare Send & Claim ===");
    console.log("Sender:", senderPublicKey.toBase58());
    console.log("Amount:", amount, token);

    const burnerKeypair = Keypair.generate();
    const burnerAddress = burnerKeypair.publicKey.toBase58();
    const passphrase = generatePassphrase();

    const burnerSecretKey = burnerKeypair.secretKey;
    const encryptedForReceiver = encryptWithPassphrase(burnerSecretKey, passphrase);
    const encryptedForSender = encryptWithSessionSignature(burnerSecretKey, sessionSignature);

    const activity = await createActivity({
      type: "send_claim",
      sender_address: senderPublicKey.toBase58(),
      receiver_address: null,
      amount,
      token_address: TOKEN_MINTS[token].toBase58(),
      status: "open",
      message: message || null,
      tx_hash: null,
      burner_address: burnerAddress,
      encrypted_for_receiver: encryptedForReceiver,
      encrypted_for_sender: encryptedForSender,
      // Stamped at create per PR #23 — Send & Claim is the documented
      // exception to "stamp at settle". Privacy work happens at create.
      provider_id: this.id,
    });

    const transfer = await buildPrivateTransfer({
      from: senderPublicKey,
      to: burnerAddress,
      amount,
      token,
    });

    return {
      activityId: activity.id,
      unsignedDepositTx: transfer.transactionBase64,
      lastValidBlockHeight: transfer.lastValidBlockHeight,
      passphrase,
      burnerAddress,
      estimatedFeeLamports: ESTIMATED_FEE_LAMPORTS,
      estimatedFeeSOL: ESTIMATED_FEE_LAMPORTS / 1_000_000_000,
    };
  },

  async submitSendClaim(input: SubmitSendClaimInput): Promise<SubmitSendClaimResult> {
    const { connection, signedDepositTx, activityId, senderPublicKey, lastValidBlockHeight } = input;

    console.log("=== MB Submit Send & Claim ===");
    console.log("Activity:", activityId);

    const activity = await getActivity(activityId);
    if (!activity) throw new Error("Activity not found");
    if (activity.type !== "send_claim") throw new Error("Not a claim link activity");
    if (activity.status !== "open") throw new Error("Claim link already processed");
    if (!activity.burner_address) throw new Error("Activity missing burner data");
    if (activity.sender_address !== senderPublicKey.toBase58()) {
      throw new Error("Not authorized to submit this claim link");
    }

    try {
      const signature = await submitSignedTransfer({
        connection,
        signedTxBase64: signedDepositTx,
        lastValidBlockHeight,
      });

      // Status stays "open" — receiver claims (or sender reclaims) later.
      // tx_hash records the privacy-hop tx; provider_id is already
      // stamped from create.
      await updateActivityStatus(activity.id, "open", {
        tx_hash: signature,
      });

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const claimLink = `${appUrl}/c/${activityId}`;

      return {
        activityId,
        depositTx: signature,
        withdrawTx: signature,
        claimLink,
        burnerAddress: activity.burner_address,
      };
    } catch (error) {
      // Privacy hop tx failed — refund posture: cancel the link entirely
      // since the burner never received funds.
      await claimActivity(activityId); // lock the row first
      await updateActivityStatus(activityId, "cancelled");
      throw error;
    }
  },

  // ============================================================
  // Claim / Reclaim — reuse PC's sponsor-paid SPL transfer code.
  // The burner has USDC in its mainnet ATA after the MB privacy hop,
  // so the existing PC code path Just Works.
  // ============================================================

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const result = await claimWithPassphrase({
      connection: input.connection,
      activityId: input.activityId,
      passphrase: input.passphrase,
      receiverAddress: input.receiverAddress,
      sponsorKeypair: input.sponsorKeypair,
      providerId: this.id,
    });

    return {
      activityId: result.activityId,
      claimTx: result.claimTx,
      amountReceived: result.amountReceived,
      token: result.token,
    };
  },

  async reclaim(input: ReclaimInput): Promise<ReclaimResult> {
    const result = await reclaimWithSignature({
      connection: input.connection,
      activityId: input.activityId,
      sessionSignature: input.sessionSignature,
      senderPublicKey: input.senderPublicKey,
      sponsorKeypair: input.sponsorKeypair,
    });

    return {
      activityId: result.activityId,
      reclaimTx: result.reclaimTx,
      amountReclaimed: result.amountReclaimed,
      token: result.token,
    };
  },
};
