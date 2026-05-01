/**
 * Umbra burner lifecycle.
 *
 * Each Umbra send creates a fresh server-owned burner keypair. The burner
 * acts as the depositor: it registers on Umbra (1-3 sponsored txs first
 * time per burner), receives the sender's USDC via a normal SPL transfer,
 * then deposits that USDC into Umbra's pool with the resulting UTXO
 * locked to either the recipient (direct Send / Fulfill) or the burner
 * itself (Send & Claim).
 *
 * Verified against mainnet 2026-04-30. See [Umbra architecture
 * decision](memory/project_umbra_architecture_decision.md) for the
 * design rationale.
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
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  getUserRegistrationFunction,
  getPublicBalanceToReceiverClaimableUtxoCreatorFunction,
  getPublicBalanceToSelfClaimableUtxoCreatorFunction,
  getUserAccountQuerierFunction,
} from "@umbra-privacy/sdk";
import type {
  ZkProverForReceiverClaimableUtxoFromPublicBalance,
  ZkProverForSelfClaimableUtxoFromPublicBalance,
} from "@umbra-privacy/sdk/interfaces";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { loadSponsorWallet } from "./sponsorWallet";
import {
  createUmbraSignerFromKeypair,
  getServerUmbraClient,
  getUmbraProverSuite,
} from "./umbraSDK";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// SOL we top the burner up with at the start of any deposit operation.
// Verified mainnet: 0.05 SOL covers registration PDA rent + 2-3 deposit
// tx fees with headroom. Excess is swept back to sponsor at the end.
const BURNER_SOL_BUDGET = 50_000_000;

// Reserve we leave on the burner before sweeping (covers the sweep tx
// itself).
const BURNER_SWEEP_RESERVE = 10_000;

// ============================================================
// Burner privkey encryption (failure-recovery only)
// ============================================================
//
// For direct Send / Request fulfill, we encrypt the burner's privkey with
// a server-held env-var key so we can auto-resume on server crash mid-
// flow. The plaintext is held in memory during the request lifetime; the
// ciphertext is persisted in the activity row's encrypted_for_sender
// column. AES-256-GCM, 96-bit IV, 128-bit auth tag.

function getBurnerEncryptionKey(): Buffer {
  const hex = process.env.UMBRA_BURNER_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "UMBRA_BURNER_ENCRYPTION_KEY env not set (32-byte hex required)"
    );
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error(
      `UMBRA_BURNER_ENCRYPTION_KEY must be 32 bytes, got ${key.length}`
    );
  }
  return key;
}

export interface ServerEncryptedBurner {
  ciphertext: string; // base64 — IV(12) || ciphertext || authTag(16)
  algorithm: "aes-256-gcm";
}

export function encryptBurnerForServer(
  burnerSecretKey: Uint8Array
): ServerEncryptedBurner {
  const key = getBurnerEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(burnerSecretKey), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const blob = Buffer.concat([iv, ct, authTag]).toString("base64");
  return { ciphertext: blob, algorithm: "aes-256-gcm" };
}

export function decryptBurnerForServer(
  payload: ServerEncryptedBurner
): Uint8Array {
  const key = getBurnerEncryptionKey();
  const buf = Buffer.from(payload.ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return new Uint8Array(pt);
}

// ============================================================
// Burner lifecycle
// ============================================================

export interface CreatedBurner {
  keypair: Keypair;
  address: string;
}

export function createBurner(): CreatedBurner {
  const keypair = Keypair.generate();
  return { keypair, address: keypair.publicKey.toBase58() };
}

/**
 * Top up burner SOL from sponsor. Skips if burner already has ≥ minimum.
 * Returns the top-up tx signature (or null if no top-up needed).
 */
export async function ensureBurnerSol(
  connection: Connection,
  burnerPubkey: PublicKey,
  minLamports: number = BURNER_SOL_BUDGET
): Promise<string | null> {
  const current = await connection.getBalance(burnerPubkey, "confirmed");
  if (current >= minLamports) return null;

  const sponsor = loadSponsorWallet();
  const top = minLamports - current + 10_000;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: sponsor.publicKey,
      toPubkey: burnerPubkey,
      lamports: top,
    })
  );
  const sig = await connection.sendTransaction(tx, [sponsor], {
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/**
 * Sweep remaining SOL from the burner back to the sponsor. Best-effort
 * cleanup — failures are logged but don't throw, since the lost SOL is
 * tiny and the deposit itself has already succeeded by this point.
 */
export async function sweepBurnerSol(
  connection: Connection,
  burnerKeypair: Keypair
): Promise<string | null> {
  try {
    const balance = await connection.getBalance(
      burnerKeypair.publicKey,
      "confirmed"
    );
    if (balance <= BURNER_SWEEP_RESERVE) return null;

    const sponsor = loadSponsorWallet();
    const lamportsToSweep = balance - BURNER_SWEEP_RESERVE;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: burnerKeypair.publicKey,
        toPubkey: sponsor.publicKey,
        lamports: lamportsToSweep,
      })
    );
    const sig = await connection.sendTransaction(tx, [burnerKeypair], {
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  } catch (err) {
    console.warn("Burner SOL sweep failed (non-fatal):", err);
    return null;
  }
}

// ============================================================
// Umbra SDK wrappers
// ============================================================

/**
 * Register the burner on Umbra. Idempotent — if already registered, the
 * SDK returns an empty signature array. Returns signatures of any sub-txs
 * that fired.
 *
 * Burner must already have SOL (call ensureBurnerSol first).
 */
export async function registerBurnerOnUmbra(
  burnerKeypair: Keypair
): Promise<string[]> {
  const signer = await createUmbraSignerFromKeypair(burnerKeypair);
  const client = await getServerUmbraClient({ signer });
  const suite = getUmbraProverSuite();

  const register = getUserRegistrationFunction(
    { client },
    { zkProver: suite.registration }
  );
  const signatures = await register({
    confidential: true,
    anonymous: true,
  });
  return signatures.map((s) => s.toString());
}

/**
 * Pre-flight check: is the given address FULLY registered on Umbra?
 *
 * "Fully registered" requires all 3 registration steps to have landed:
 *   1. InitialiseEncryptedUserAccount (creates the PDA → makes state="exists")
 *   2. RegisterTokenPublicKey (sets x25519PublicKey)
 *   3. RegisterUserForAnonymousUsageV11 (sets userCommitment after Arcium MPC callback)
 *
 * Checking only `state === "exists"` is too lenient: a wallet that did
 * step 1 but ran out of SOL before step 3 would falsely register as
 * "registered" and the picker would let them try to send, only for the
 * deposit to fail mid-flight.
 *
 * Matches the deeper check in `useUmbraRegister` so client and server
 * agree on what "registered" means.
 */
export async function isAddressRegisteredOnUmbra(
  address: string
): Promise<boolean> {
  // We can use any keypair to construct the read client — the query
  // doesn't sign. Use a throwaway since the SDK wants a signer.
  const throwaway = Keypair.generate();
  const signer = await createUmbraSignerFromKeypair(throwaway);
  const client = await getServerUmbraClient({ signer });
  const query = getUserAccountQuerierFunction({ client });
  const result = await query(address as any);
  if (result.state !== "exists") return false;
  const data = (result as any).data;
  return Boolean(data?.x25519PublicKey && data?.userCommitment);
}

/**
 * Burner deposits public USDC into a UTXO locked to the recipient's
 * registered Umbra commitment. Used for direct Send and Request fulfill.
 *
 * Recipient MUST be registered on Umbra (call isAddressRegisteredOnUmbra
 * pre-flight). If not, the SDK throws CreateUtxoError at account-fetch.
 */
export async function depositToReceiverClaimable(
  burnerKeypair: Keypair,
  amountBaseUnits: bigint,
  recipientAddress: string,
  mint: string = USDC_MINT
): Promise<{
  closeProofAccountSignature?: string;
  createProofAccountSignature: string;
  createUtxoSignature: string;
}> {
  const signer = await createUmbraSignerFromKeypair(burnerKeypair);
  const client = await getServerUmbraClient({ signer });
  const suite = getUmbraProverSuite();

  // Variance cast — see umbraSDK.ts. The deposit factory wants the narrower
  // FromPublicBalance prover; suite slot is wider.
  const deposit = getPublicBalanceToReceiverClaimableUtxoCreatorFunction(
    { client },
    {
      zkProver:
        suite.utxoReceiverClaimable as unknown as ZkProverForReceiverClaimableUtxoFromPublicBalance,
    }
  );

  const result = await deposit({
    amount: amountBaseUnits as any,
    destinationAddress: recipientAddress as any,
    mint: mint as any,
  });

  return {
    closeProofAccountSignature: result.closeProofAccountSignature?.toString(),
    createProofAccountSignature: result.createProofAccountSignature.toString(),
    createUtxoSignature: result.createUtxoSignature.toString(),
  };
}

/**
 * Burner deposits public USDC into a self-claimable UTXO (for Send &
 * Claim). The UTXO is locked to the burner's own master seed; recipient
 * gets the burner privkey via the claim link passphrase.
 *
 * Verified working on mainnet 2026-04-30.
 */
export async function depositToSelfClaimable(
  burnerKeypair: Keypair,
  amountBaseUnits: bigint,
  mint: string = USDC_MINT
): Promise<{
  closeProofAccountSignature?: string;
  createProofAccountSignature: string;
  createUtxoSignature: string;
}> {
  const signer = await createUmbraSignerFromKeypair(burnerKeypair);
  const client = await getServerUmbraClient({ signer });
  const suite = getUmbraProverSuite();

  const deposit = getPublicBalanceToSelfClaimableUtxoCreatorFunction(
    { client },
    {
      zkProver:
        suite.utxoSelfClaimable as unknown as ZkProverForSelfClaimableUtxoFromPublicBalance,
    }
  );

  const result = await deposit({
    amount: amountBaseUnits as any,
    destinationAddress: signer.address,
    mint: mint as any,
  });

  return {
    closeProofAccountSignature: result.closeProofAccountSignature?.toString(),
    createProofAccountSignature: result.createProofAccountSignature.toString(),
    createUtxoSignature: result.createUtxoSignature.toString(),
  };
}

// ============================================================
// Sender → burner SPL transfer (unsigned, for user to sign)
// ============================================================

export interface BuildBurnerDepositTxArgs {
  connection: Connection;
  senderPubkey: PublicKey;
  burnerPubkey: PublicKey;
  amountBaseUnits: bigint;
  mint: PublicKey;
}

export interface BuildBurnerDepositTxResult {
  unsignedTxBase64: string;
  lastValidBlockHeight: number;
  burnerAta: string;
}

/**
 * Build the unsigned tx the SENDER signs: SPL transfer from sender's ATA
 * to the burner's ATA. Sponsor pays the SOL fee (so user signs token
 * authority only — no SOL needed); sender signs as token authority.
 *
 * The burner's ATA is created by this tx if it doesn't exist (sponsor
 * pays the rent ~0.002 SOL, reclaimable later if/when we close the ATA).
 */
export async function buildSenderToBurnerTransferTx(
  args: BuildBurnerDepositTxArgs
): Promise<BuildBurnerDepositTxResult> {
  const { connection, senderPubkey, burnerPubkey, amountBaseUnits, mint } =
    args;
  const sponsor = loadSponsorWallet();

  const senderAta = await getAssociatedTokenAddress(mint, senderPubkey);
  const burnerAta = await getAssociatedTokenAddress(mint, burnerPubkey);

  const instructions: any[] = [];

  // Always create the burner's ATA — it's a fresh keypair, never has one.
  // Sponsor pays the rent.
  instructions.push(
    createAssociatedTokenAccountInstruction(
      sponsor.publicKey,
      burnerAta,
      burnerPubkey,
      mint
    )
  );

  // SPL transfer sender → burner ATA. Sender authorizes (signs).
  instructions.push(
    createTransferInstruction(
      senderAta,
      burnerAta,
      senderPubkey,
      amountBaseUnits
    )
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(
    "confirmed"
  );

  // Sponsor as fee payer means user doesn't need SOL to send. User's
  // signature will be added later via wallet.signTransaction.
  const messageV0 = new TransactionMessage({
    payerKey: sponsor.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  // Sponsor partially signs (fee payer). Sender signs second when they
  // submit back to us.
  tx.sign([sponsor]);

  return {
    unsignedTxBase64: Buffer.from(tx.serialize()).toString("base64"),
    lastValidBlockHeight,
    burnerAta: burnerAta.toBase58(),
  };
}

/**
 * Submit the user-signed sender→burner transfer + wait for confirmation.
 */
export async function submitSenderToBurnerTransfer(
  connection: Connection,
  signedTxBase64: string,
  lastValidBlockHeight: number
): Promise<string> {
  const txBytes = Buffer.from(signedTxBase64, "base64");
  const sig = await connection.sendRawTransaction(txBytes, {
    preflightCommitment: "confirmed",
  });

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  return sig;
}
