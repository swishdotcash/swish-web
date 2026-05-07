/**
 * Recover USDC stuck in a burner ATA from a failed Umbra Send & Claim.
 *
 * Use when: an Umbra SC failed mid-flow after the sender→burner SPL
 * transfer landed but before the Umbra deposit completed. The 1 USDC
 * is sitting at the burner's USDC ATA on mainnet (NOT inside Umbra's
 * protocol). Activity is typically marked `cancelled`.
 *
 * The reclaim API path doesn't help because:
 *   - It requires status=open (claimActivity fails on cancelled rows)
 *   - Its claim flow scans Umbra's pool for UTXOs that don't exist
 *
 * This script goes around all that:
 *   1. Decrypt burner privkey using sender's UMBRA session signature
 *   2. SPL transfer all burner USDC → sender's mainnet ATA
 *   3. Sponsor pays SOL fee + ensures sender's ATA exists
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/recover-stuck-umbra-sc.ts \
 *     <activityId> <senderSessionSigBase64>
 *
 * To get the session sig: sender opens devtools on swish.cash (must
 * have signed in this browser session), runs in console:
 *   sessionStorage.getItem('umbra_session_signature')
 * That's the value to pass as the second arg.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import { createClient } from "@supabase/supabase-js";

import { decryptWithSessionSignature } from "../lib/crypto";
import { loadSponsorWallet } from "../lib/sponsor/sponsorWallet";

async function main() {
  const activityId = process.argv[2];
  const sigBase64 = process.argv[3];
  if (!activityId || !sigBase64) {
    console.error(
      "Usage: recover-stuck-umbra-sc.ts <activityId> <senderSessionSigBase64>"
    );
    process.exit(1);
  }

  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL not set");
  const conn = new Connection(rpcUrl, "confirmed");

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log("=== Recover stuck Umbra SC ===");
  console.log("Activity:", activityId);

  const { data: activity, error } = await supabase
    .from("activity")
    .select("*")
    .eq("id", activityId)
    .single();
  if (error || !activity) throw new Error("Activity not found");
  if (activity.type !== "send_claim") throw new Error("Not a send_claim row");
  if (activity.provider_id !== "umbra")
    throw new Error("Not an Umbra activity");
  if (!activity.burner_address) throw new Error("Missing burner_address");
  if (!activity.encrypted_for_sender)
    throw new Error("Missing encrypted_for_sender");

  console.log("Sender:", activity.sender_address);
  console.log("Burner:", activity.burner_address);
  console.log("Status:", activity.status);

  // Decode session sig
  const sigBytes = Uint8Array.from(Buffer.from(sigBase64, "base64"));
  if (sigBytes.length !== 64) {
    throw new Error(`Session sig must be 64 bytes, got ${sigBytes.length}`);
  }

  // Decrypt burner privkey
  let burnerSecretKey: Uint8Array;
  try {
    burnerSecretKey = decryptWithSessionSignature(
      activity.encrypted_for_sender as any,
      sigBytes
    );
  } catch (e: any) {
    throw new Error(
      `Decrypt failed (wrong session sig?): ${e.message ?? String(e)}`
    );
  }
  const burnerKeypair = Keypair.fromSecretKey(burnerSecretKey);
  if (burnerKeypair.publicKey.toBase58() !== activity.burner_address) {
    throw new Error("Burner key mismatch — wrong session sig?");
  }
  console.log("✓ Decrypted burner key");

  // Find balances
  const senderPubkey = new PublicKey(activity.sender_address);
  const mint = new PublicKey(activity.token_address);
  const burnerAta = await getAssociatedTokenAddress(
    mint,
    burnerKeypair.publicKey
  );
  const senderAta = await getAssociatedTokenAddress(mint, senderPubkey);

  let burnerBalance: bigint;
  try {
    const acc = await getAccount(conn, burnerAta);
    burnerBalance = acc.amount;
  } catch (e) {
    if (e instanceof TokenAccountNotFoundError) {
      throw new Error("Burner ATA doesn't exist — nothing to recover");
    }
    throw e;
  }
  console.log("Burner USDC balance:", Number(burnerBalance) / 1e6, "USDC");
  if (burnerBalance === BigInt(0)) {
    console.log("Nothing to sweep");
    return;
  }

  // Build sweep tx
  const sponsor = loadSponsorWallet();
  console.log("Sponsor:", sponsor.publicKey.toBase58());

  const tx = new Transaction();
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      sponsor.publicKey,
      senderAta,
      senderPubkey,
      mint
    )
  );
  tx.add(
    createTransferInstruction(
      burnerAta,
      senderAta,
      burnerKeypair.publicKey,
      burnerBalance
    )
  );
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(
    "confirmed"
  );
  tx.recentBlockhash = blockhash;
  tx.feePayer = sponsor.publicKey;
  tx.partialSign(sponsor, burnerKeypair);

  console.log("Submitting sweep tx...");
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
  });
  await conn.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  console.log("✓ Sweep complete:", sig);
  console.log(
    `\n✅ ${Number(burnerBalance) / 1e6} USDC returned to ${senderPubkey.toBase58()}`
  );
}

main().catch((err) => {
  console.error("\n❌ Recovery failed:", err);
  process.exit(1);
});
