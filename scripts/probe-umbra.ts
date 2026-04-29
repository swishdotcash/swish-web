/**
 * Smoke test: verify the server-side Umbra client + prover suite work in Node.
 *
 * What we're checking:
 * - SDK constructs a client without browser-only code blowing up
 * - Prover suite asset providers load (CDN reachable, fetch works in Node)
 * - A simple read query (`QueryUserAccount`) succeeds against mainnet
 *
 * Run: bun scripts/probe-umbra.ts
 *
 * Throwaway — delete after PR 6 lands.
 */

import { Keypair } from "@solana/web3.js";
import { getUserAccountQuerierFunction } from "@umbra-privacy/sdk";
import {
  createUmbraSignerFromKeypair,
  getServerUmbraClient,
  getUmbraProverSuite,
} from "../lib/sponsor/umbraSDK";

async function main() {
  console.log("=== Umbra server-side smoke test ===\n");

  console.log("[1/4] Building prover suite (loads from CDN)...");
  const suite = getUmbraProverSuite();
  console.log("  ✓ Suite constructed with", Object.keys(suite).length, "provers");

  console.log("\n[2/4] Constructing in-memory signer (dummy keypair)...");
  const dummyKeypair = Keypair.generate();
  const signer = await createUmbraSignerFromKeypair(dummyKeypair);
  console.log("  ✓ Signer address:", signer.address);

  console.log("\n[3/4] Constructing server Umbra client (deferred master seed)...");
  const client = await getServerUmbraClient({
    signer,
    deferMasterSeedSignature: true,
  });
  console.log("  ✓ Client constructed");

  console.log("\n[4/4] Querying user account for an arbitrary address...");
  const arbitraryAddress = "812MpxaVueRfDRCNRCRNjg5NyT9rJEAFjNzkTSt4RvkG";
  const query = getUserAccountQuerierFunction({ client });
  const result = await query(arbitraryAddress as any);
  console.log("  ✓ Query result:", JSON.stringify(result, null, 2));

  console.log("\n✅ All checks passed. SDK runs server-side, prover assets load, queries reach indexer.");
}

main().catch((err) => {
  console.error("\n❌ Smoke test failed:");
  console.error(err);
  process.exit(1);
});
