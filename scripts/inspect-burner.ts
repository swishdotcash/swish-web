import "dotenv/config";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

async function main() {
  const burnerStr = process.argv[2];
  if (!burnerStr) {
    throw new Error("Usage: tsx scripts/inspect-burner.ts <burner-address>");
  }
  const rpcUrl = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL!;
  const connection = new Connection(rpcUrl, "confirmed");
  const burner = new PublicKey(burnerStr);

  const balance = await connection.getBalance(burner);
  console.log(`Burner: ${burner.toBase58()}`);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL\n`);

  const sigs = await connection.getSignaturesForAddress(burner, { limit: 15 });
  console.log(`Recent ${sigs.length} signatures:`);
  for (const s of sigs) {
    const ageS = s.blockTime ? Math.floor(Date.now() / 1000 - s.blockTime) : -1;
    const status = s.err ? `❌ ${JSON.stringify(s.err)}` : "✅";
    console.log(`  [${ageS}s] ${status}  ${s.signature}`);

    const tx = await connection.getTransaction(s.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) continue;
    if (tx.meta?.logMessages) {
      const programs = new Set<string>();
      for (const l of tx.meta.logMessages) {
        const m = l.match(/Program (\w+) invoke/);
        if (m) programs.add(m[1]);
      }
      if (programs.size) {
        console.log(`    programs: ${Array.from(programs).slice(0, 4).join(", ")}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
