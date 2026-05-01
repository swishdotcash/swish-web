/**
 * Sweep leftover SOL from a stuck burner back to sponsor.
 *
 * Use when the recover-stuck-umbra-send script bailed early because the
 * burner USDC ATA was empty (USDC was already moved or never landed),
 * but the burner still holds the 0.05 SOL top-up. This script just
 * decrypts the burner key, sweeps the SOL, and exits.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/sweep-burner-sol.ts <activityId> [<activityId> ...]
 */

import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";

import { decryptBurnerForServer } from "../lib/sponsor/umbraBurner";
import { loadSponsorWallet } from "../lib/sponsor/sponsorWallet";

// Base tx fee for a single-signer transfer is 5000 lamports. We leave
// exactly that — the burner ends with 0 lamports after the transfer, so
// the System program closes the account (no rent-exempt requirement to
// satisfy). All other amounts come back to sponsor.
const RESERVE_LAMPORTS = 5_000;

async function main() {
  const activityIds = process.argv.slice(2);
  if (activityIds.length === 0) {
    console.error("Usage: sweep-burner-sol.ts <activityId> [...]");
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

  const sponsor = loadSponsorWallet();
  console.log("Sponsor:", sponsor.publicKey.toBase58());

  let totalSwept = 0;
  for (const activityId of activityIds) {
    console.log("─".repeat(60));
    console.log("Activity:", activityId);

    const { data: row, error } = await supabase
      .from("activity")
      .select("burner_address, encrypted_for_sender")
      .eq("id", activityId)
      .single();

    if (error || !row) {
      console.error("  ❌ row not found");
      continue;
    }
    if (!row.burner_address || !row.encrypted_for_sender) {
      console.error("  ❌ missing burner data");
      continue;
    }

    const ciphertext = (row.encrypted_for_sender as any).ciphertext;
    if (!ciphertext) {
      console.error("  ❌ missing ciphertext");
      continue;
    }

    let burnerKeypair: Keypair;
    try {
      const sk = decryptBurnerForServer({
        ciphertext,
        algorithm: "aes-256-gcm",
      });
      burnerKeypair = Keypair.fromSecretKey(sk);
    } catch (e: any) {
      console.error("  ❌ decrypt failed:", e.message);
      continue;
    }

    if (burnerKeypair.publicKey.toBase58() !== row.burner_address) {
      console.error("  ❌ burner key mismatch");
      continue;
    }

    const balance = await conn.getBalance(burnerKeypair.publicKey, "confirmed");
    console.log("  Burner:", burnerKeypair.publicKey.toBase58());
    console.log("  Balance:", balance, `lamports (${balance / 1e9} SOL)`);

    if (balance <= RESERVE_LAMPORTS) {
      console.log("  → nothing to sweep (≤ reserve)");
      continue;
    }

    const lamportsToSweep = balance - RESERVE_LAMPORTS;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: burnerKeypair.publicKey,
        toPubkey: sponsor.publicKey,
        lamports: lamportsToSweep,
      })
    );
    const sig = await conn.sendTransaction(tx, [burnerKeypair], {
      preflightCommitment: "confirmed",
    });
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`  ✓ swept ${lamportsToSweep / 1e9} SOL → sponsor`);
    console.log(`    sig: ${sig}`);
    totalSwept += lamportsToSweep;
  }

  console.log("─".repeat(60));
  console.log(
    `\n✅ Total swept: ${totalSwept} lamports (${totalSwept / 1e9} SOL)`
  );
}

main().catch((err) => {
  console.error("\n❌ Sweep failed:", err);
  process.exit(1);
});
