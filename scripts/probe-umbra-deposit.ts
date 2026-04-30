/**
 * Umbra deposit probe.
 *
 * Exercises the full server-side burner-pattern deposit against mainnet:
 *   1. Use a pre-funded keypair as a burner
 *   2. Register the burner on Umbra (1-3 sponsored txs by burner's SOL)
 *   3. Deposit USDC to a self-claimable UTXO (2-3 txs by burner's SOL)
 *   4. Print results, costs, and signatures
 *
 * Why a probe: building lib/sponsor/umbraBurner.ts blind from type
 * signatures led to ~10 type errors. This probe verifies actual SDK
 * shapes against a live deposit, gives us a known-working invocation
 * pattern, and surfaces real costs before we commit production code.
 *
 * Setup:
 *   1. Generate a test keypair:
 *        solana-keygen new --outfile /tmp/umbra-burner.json --no-bip39-passphrase
 *   2. Fund it from your main wallet:
 *        - ~0.0005 SOL (covers registration + deposit fees, headroom)
 *        - Some USDC (e.g., 0.05) — will be deposited into Umbra pool
 *   3. Export the keypair as base58 secret key:
 *        UMBRA_PROBE_KEYPAIR_BS58=<base58 of secretKey bytes>
 *      Or pass via flag: --keypair-file /tmp/umbra-burner.json
 *   4. Run:
 *        bun scripts/probe-umbra-deposit.ts
 *
 * Throwaway — delete after Phase 2 lands.
 */

import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";

import {
  getUserRegistrationFunction,
  getPublicBalanceToSelfClaimableUtxoCreatorFunction,
} from "@umbra-privacy/sdk";
import type { ZkProverForSelfClaimableUtxoFromPublicBalance } from "@umbra-privacy/sdk/interfaces";

import {
  createUmbraSignerFromKeypair,
  getServerUmbraClient,
  getUmbraProverSuite,
} from "../lib/sponsor/umbraSDK";
import { loadSponsorWallet } from "../lib/sponsor/sponsorWallet";

// USDC mainnet mint
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Amount to deposit (USDC has 6 decimals). Override via env var to A/B test
// the fee model. Defaults to 0.5 USDC for the second probe (first probe used
// 0.05 USDC and consumed 0.1 — testing if fee scales).
const DEPOSIT_AMOUNT_BASE_UNITS = BigInt(
  process.env.UMBRA_PROBE_AMOUNT_BASE_UNITS ?? "500000"
);

function loadKeypairFromEnv(): Keypair {
  const fileFlag = process.argv.indexOf("--keypair-file");
  if (fileFlag !== -1) {
    const path = process.argv[fileFlag + 1];
    if (!path) throw new Error("--keypair-file requires a path");
    const json = JSON.parse(readFileSync(path, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(json));
  }
  const bs58Key = process.env.UMBRA_PROBE_KEYPAIR_BS58;
  if (!bs58Key) {
    throw new Error(
      "Set UMBRA_PROBE_KEYPAIR_BS58 (base58 of secretKey) or pass --keypair-file <path>"
    );
  }
  return Keypair.fromSecretKey(bs58.decode(bs58Key));
}

async function main() {
  console.log("=== Umbra deposit probe (mainnet) ===\n");

  const burner = loadKeypairFromEnv();
  console.log("Burner address:", burner.publicKey.toBase58());

  // Top up burner from sponsor only if it's below threshold. Registration
  // creates an EncryptedUserAccount PDA which requires rent funded by the fee
  // payer (burner). 0.01 SOL is too tight; ensure at least 0.05 SOL.
  console.log("\n[0/3] Checking burner SOL balance...");
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL not set");
  const conn = new Connection(rpcUrl, "confirmed");
  const minBalance = 50_000_000; // 0.05 SOL minimum
  const currentBalance = await conn.getBalance(burner.publicKey, "confirmed");
  if (currentBalance < minBalance) {
    const sponsor = loadSponsorWallet();
    const topUpLamports = minBalance - currentBalance + 10_000;
    const topUpTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sponsor.publicKey,
        toPubkey: burner.publicKey,
        lamports: topUpLamports,
      })
    );
    const topUpSig = await conn.sendTransaction(topUpTx, [sponsor], {
      preflightCommitment: "confirmed",
    });
    await conn.confirmTransaction(topUpSig, "confirmed");
    const newBalance = await conn.getBalance(burner.publicKey, "confirmed");
    console.log(
      `  ✓ Top-up: +${topUpLamports} lamports. Now ${newBalance / 1e9} SOL. Tx: ${topUpSig}`
    );
  } else {
    console.log(
      `  ✓ Burner already has ${currentBalance / 1e9} SOL — no top-up needed`
    );
  }

  console.log("\n[1/3] Constructing Umbra client as burner...");
  const signer = await createUmbraSignerFromKeypair(burner);
  const client = await getServerUmbraClient({ signer });
  console.log("  ✓ Client constructed");

  console.log("\n[2/3] Registering burner on Umbra...");
  const suiteForReg = getUmbraProverSuite();
  const register = getUserRegistrationFunction(
    { client },
    { zkProver: suiteForReg.registration }
  );
  const startReg = Date.now();
  const registrationSigs = await register({
    confidential: true,
    anonymous: true,
  });
  const regMs = Date.now() - startReg;
  console.log(`  ✓ Registration completed in ${regMs}ms`);
  console.log(`  → ${registrationSigs.length} txs:`);
  for (const sig of registrationSigs) {
    console.log(`    ${sig.toString()}`);
  }

  console.log("\n[3/3] Depositing USDC to self-claimable UTXO...");
  const suite = suiteForReg;
  // Variance cast: suite.utxoSelfClaimable is the wider IZkProverForSelfClaimableUtxo
  // (handles both FromPublic and FromEncrypted inputs). The deposit factory wants the
  // narrower FromPublicBalance variant. Cast back down — safe because we built the
  // suite from the FromPublicBalance prover originally (see umbraSDK.ts).
  const deposit = getPublicBalanceToSelfClaimableUtxoCreatorFunction(
    { client },
    {
      zkProver: suite.utxoSelfClaimable as unknown as ZkProverForSelfClaimableUtxoFromPublicBalance,
    }
  );

  const startDep = Date.now();
  const result = await deposit({
    amount: DEPOSIT_AMOUNT_BASE_UNITS as any,
    destinationAddress: signer.address,
    mint: USDC_MINT as any,
  });
  const depMs = Date.now() - startDep;

  console.log(`  ✓ Deposit completed in ${depMs}ms`);
  console.log(
    `  closeProofAccountSignature: ${result.closeProofAccountSignature?.toString() ?? "(skipped)"}`
  );
  console.log(
    `  createProofAccountSignature: ${result.createProofAccountSignature.toString()}`
  );
  console.log(
    `  createUtxoSignature: ${result.createUtxoSignature.toString()}`
  );

  console.log("\n✅ Probe completed successfully.");
  console.log("\nFindings to record:");
  console.log(`  - Registration tx count: ${registrationSigs.length}`);
  console.log(
    `  - Deposit tx count: ${result.closeProofAccountSignature ? 3 : 2}`
  );
  console.log(`  - Registration latency: ${regMs}ms`);
  console.log(`  - Deposit latency: ${depMs}ms`);
}

main().catch((err) => {
  console.error("\n❌ Probe failed:");
  console.error(err);
  process.exit(1);
});
