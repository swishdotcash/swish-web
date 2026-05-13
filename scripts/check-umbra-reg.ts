import "dotenv/config";
import { isAddressRegisteredOnUmbra } from "@/lib/sponsor/umbraBurner";
import { Keypair } from "@solana/web3.js";

async function main() {
  const addr = process.argv[2];
  if (!addr) throw new Error("Usage: tsx scripts/check-umbra-reg.ts <address>");

  // Direct deeper inspection — the helper returns boolean, but I want the raw state.
  const { createUmbraSignerFromKeypair, getServerUmbraClient } = await import(
    "@/lib/sponsor/umbraSDK"
  );
  const { getUserAccountQuerierFunction } = await import("@umbra-privacy/sdk");

  const throwaway = Keypair.generate();
  const signer = await createUmbraSignerFromKeypair(throwaway);
  const client = await getServerUmbraClient({ signer });
  const query = getUserAccountQuerierFunction({ client });
  const result = await query(addr as any);

  console.log(`Burner: ${addr}`);
  console.log(`State: ${result.state}`);
  if (result.state === "exists") {
    const data = (result as any).data;
    console.log(`x25519PublicKey: ${data?.x25519PublicKey ? "✅ set" : "❌ missing"}`);
    console.log(`userCommitment:  ${data?.userCommitment ? "✅ set" : "❌ missing (Arcium callback pending)"}`);
    console.log(`\nFully registered: ${data?.x25519PublicKey && data?.userCommitment ? "YES" : "NO"}`);
  }

  console.log(`\nFully-registered helper: ${await isAddressRegisteredOnUmbra(addr)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
