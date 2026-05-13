import "dotenv/config";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

async function main() {
  const rpcUrl = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL!;
  const connection = new Connection(rpcUrl, "confirmed");
  const sponsor = new PublicKey("NrfwZRcQdGyJJQTtH5ce4hfwVJhBAfn4qAE48GN1TJG");

  const sigs = await connection.getSignaturesForAddress(sponsor, { limit: 8 });
  console.log(`Recent ${sigs.length} signatures for sponsor:`);
  for (const s of sigs) {
    const ageS = s.blockTime ? Math.floor(Date.now() / 1000 - s.blockTime) : -1;
    console.log(`\n[${ageS}s ago] ${s.signature}`);
    console.log(`  err: ${s.err ? JSON.stringify(s.err) : "none"}`);
    if (s.memo) console.log(`  memo: ${s.memo}`);

    const tx = await connection.getTransaction(s.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) {
      console.log("  (tx not found)");
      continue;
    }

    const keys = tx.transaction.message.getAccountKeys
      ? tx.transaction.message.getAccountKeys()
      : null;
    const accounts = keys
      ? keys.staticAccountKeys.map((k) => k.toBase58())
      : tx.transaction.message.staticAccountKeys.map((k: any) =>
          typeof k === "string" ? k : k.toBase58()
        );

    const pre = tx.meta?.preBalances ?? [];
    const post = tx.meta?.postBalances ?? [];
    for (let i = 0; i < accounts.length; i++) {
      const delta = (post[i] ?? 0) - (pre[i] ?? 0);
      if (Math.abs(delta) >= 0.0001 * LAMPORTS_PER_SOL) {
        const sol = (delta / LAMPORTS_PER_SOL).toFixed(6);
        console.log(`  ${accounts[i]} ${delta > 0 ? "+" : ""}${sol} SOL`);
      }
    }
    if (tx.meta?.logMessages) {
      const interesting = tx.meta.logMessages.filter((l) =>
        /Program|invoke|success|fail/i.test(l)
      );
      const programs = new Set<string>();
      for (const l of interesting) {
        const m = l.match(/Program (\w+) invoke/);
        if (m) programs.add(m[1]);
      }
      if (programs.size) {
        console.log(`  programs: ${Array.from(programs).join(", ")}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
