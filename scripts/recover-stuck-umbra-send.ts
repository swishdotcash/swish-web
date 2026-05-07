/**
 * Recover a stuck Umbra direct Send.
 *
 * For an activity row where Umbra's prepare succeeded (burner created,
 * sender's USDC landed in burner ATA) but submit's Umbra deposit hung
 * before completing, this sweeps the USDC out of the burner ATA back to
 * the sender's ATA, sweeps remaining burner SOL back to sponsor, and
 * marks the activity cancelled.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/recover-stuck-umbra-send.ts <activityId>
 *
 * Throwaway — delete after we've migrated dev server off Bun (where the
 * ZK prover hangs in worker shim).
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";

import { getActivity, updateActivityStatus } from "../lib/database";
import { decryptBurnerForServer } from "../lib/sponsor/umbraBurner";
import { loadSponsorWallet } from "../lib/sponsor/sponsorWallet";
import { TOKEN_MINTS } from "../lib/privacycash/tokens";

async function main() {
  const activityId = process.argv[2];
  if (!activityId) {
    console.error("Usage: recover-stuck-umbra-send.ts <activityId>");
    process.exit(1);
  }

  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL not set");
  const conn = new Connection(rpcUrl, "confirmed");

  console.log("=== Recover stuck Umbra send ===");
  console.log("Activity:", activityId);

  const activity = await getActivity(activityId);
  if (!activity) throw new Error("Activity not found");
  console.log(
    "Provider:",
    activity.provider_id,
    "| Status:",
    activity.status,
    "| Sender:",
    activity.sender_address
  );
  if (activity.provider_id !== "umbra") {
    throw new Error("Activity is not an Umbra send");
  }
  if (!activity.burner_address || !activity.encrypted_for_sender) {
    throw new Error("Activity missing burner data — nothing to recover");
  }

  // Decrypt burner privkey using the server-held env-var key
  const ciphertext = (activity.encrypted_for_sender as any).ciphertext;
  if (!ciphertext) throw new Error("Activity missing encrypted_for_sender.ciphertext");
  const burnerSecretKey = decryptBurnerForServer({
    ciphertext,
    algorithm: "aes-256-gcm",
  });
  const burnerKeypair = Keypair.fromSecretKey(burnerSecretKey);
  if (burnerKeypair.publicKey.toBase58() !== activity.burner_address) {
    throw new Error("Decrypted burner key doesn't match burner_address — abort");
  }
  console.log("✓ Decrypted burner key:", burnerKeypair.publicKey.toBase58());

  const senderPubkey = new PublicKey(activity.sender_address!);
  const mint = new PublicKey(activity.token_address!);
  const burnerAta = await getAssociatedTokenAddress(
    mint,
    burnerKeypair.publicKey
  );
  const senderAta = await getAssociatedTokenAddress(mint, senderPubkey);

  let burnerBalance: bigint;
  try {
    const acc = await getAccount(conn, burnerAta);
    burnerBalance = acc.amount;
    console.log("✓ Burner ATA balance:", Number(burnerBalance) / 1e6, "USDC");
  } catch (e) {
    throw new Error("Burner ATA not found — nothing to sweep");
  }

  if (burnerBalance === BigInt(0)) {
    console.log("Burner ATA empty — nothing to sweep");
    await updateActivityStatus(activityId, "cancelled");
    return;
  }

  const sponsor = loadSponsorWallet();

  // Build sweep tx: ensure sender ATA exists (idempotent), then transfer
  // entire burner balance back to sender. Sponsor pays SOL fee + ATA
  // rent if needed; burner signs token authority.
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

  const { blockhash, lastValidBlockHeight } =
    await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = sponsor.publicKey;

  console.log("Signing + submitting sweep tx...");
  tx.partialSign(sponsor, burnerKeypair);
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
  });
  await conn.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  console.log("✓ Sweep complete:", sig);

  // Sweep remaining burner SOL back to sponsor (best effort)
  try {
    const burnerSol = await conn.getBalance(
      burnerKeypair.publicKey,
      "confirmed"
    );
    const reserve = 10_000;
    if (burnerSol > reserve) {
      const solSweep = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: burnerKeypair.publicKey,
          toPubkey: sponsor.publicKey,
          lamports: burnerSol - reserve,
        })
      );
      const solSig = await conn.sendTransaction(solSweep, [burnerKeypair], {
        preflightCommitment: "confirmed",
      });
      await conn.confirmTransaction(solSig, "confirmed");
      console.log(
        "✓ Burner SOL swept (",
        (burnerSol - reserve) / 1e9,
        "SOL ):",
        solSig
      );
    }
  } catch (e) {
    console.warn("Burner SOL sweep failed (non-fatal):", (e as Error).message);
  }

  await updateActivityStatus(activityId, "cancelled");
  console.log("✓ Activity marked cancelled");
  console.log("\n✅ Recovery complete. Sender got their USDC back.");
}

main().catch((err) => {
  console.error("\n❌ Recovery failed:", err);
  process.exit(1);
});
