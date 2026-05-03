import { NextResponse } from "next/server";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
  createBurner,
  ensureBurnerSol,
  registerBurnerOnUmbra,
} from "@/lib/sponsor/umbraBurner";

/**
 * DEV-ONLY: trigger a fresh Umbra registration end-to-end inside Next.js
 * to verify the ZK prover doesn't hang in this runtime context.
 *
 * Generates a throwaway burner, funds it from sponsor SOL, registers it
 * on Umbra (1-3 sub-txs including the Poseidon commitment that requires
 * a ZK proof), and reports timings.
 *
 * Zero USDC at stake — burner is empty, ATA never created.
 *
 * Delete after we've verified prover compatibility.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production" && process.env.RAILWAY_ENVIRONMENT) {
    // Belt-and-suspenders: forbid in real prod (Railway). Local prod
    // build is fine.
    return NextResponse.json(
      { error: "Dev endpoint not available in production" },
      { status: 403 }
    );
  }

  const { Connection } = await import("@solana/web3.js");
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    return NextResponse.json({ error: "RPC_URL not set" }, { status: 500 });
  }
  const connection = new Connection(rpcUrl, "confirmed");

  const start = Date.now();
  const stages: Array<{ stage: string; ms: number; result?: string }> = [];

  try {
    const burner = createBurner();
    stages.push({ stage: "createBurner", ms: Date.now() - start, result: burner.address });

    const t1 = Date.now();
    const topUpSig = await ensureBurnerSol(connection, burner.keypair.publicKey);
    stages.push({
      stage: "ensureBurnerSol",
      ms: Date.now() - t1,
      result: topUpSig ?? "skipped",
    });

    const t2 = Date.now();
    const registrationSigs = await registerBurnerOnUmbra(burner.keypair);
    stages.push({
      stage: "registerBurnerOnUmbra",
      ms: Date.now() - t2,
      result: `${registrationSigs.length} txs: ${registrationSigs.join(",")}`,
    });

    return NextResponse.json({
      success: true,
      totalMs: Date.now() - start,
      burnerAddress: burner.address,
      stages,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err?.message ?? String(err),
        stages,
        elapsedMs: Date.now() - start,
      },
      { status: 500 }
    );
  }
}
