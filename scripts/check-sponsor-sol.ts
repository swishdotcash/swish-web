import "dotenv/config";
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";

async function main() {
  const rpcUrl = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;
  const sponsorKey = process.env.SPONSOR_PRIVATE_KEY;
  if (!rpcUrl || !sponsorKey) {
    throw new Error("Missing RPC_URL or SPONSOR_PRIVATE_KEY");
  }
  const connection = new Connection(rpcUrl, "confirmed");
  const sponsor = Keypair.fromSecretKey(bs58.decode(sponsorKey));
  const lamports = await connection.getBalance(sponsor.publicKey);
  const sol = lamports / 1e9;
  console.log("Sponsor:", sponsor.publicKey.toBase58());
  console.log("SOL:", sol.toFixed(4));
  const minRequired = 0.02;
  if (sol < minRequired) {
    console.log(`\n⚠️  Below ${minRequired} SOL — top up before mainnet test`);
    process.exit(1);
  }
  console.log(`\n✅ Sufficient for ~${Math.floor(sol / 0.007)} Umbra SCs (~$0.96 each, 0.007 SOL @ $130)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
