import { NextRequest, NextResponse } from "next/server";

import { markUmbraUtxosClaimed } from "@/lib/database";

/**
 * POST /api/umbra/claimed-utxos/mark
 *
 * Body: `{ walletAddress, utxos: [{treeIndex, insertionIndex}] }`
 *
 * Marks UTXOs as claimed for the given wallet. Idempotent (PK collision
 * silently dropped). Called by the client after a successful claim
 * transaction so subsequent scans filter out the now-nullified leaves.
 *
 * No auth: see GET counterpart for the rationale.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      walletAddress,
      utxos,
    }: {
      walletAddress: string;
      utxos: { treeIndex: number; insertionIndex: number }[];
    } = body;

    if (!walletAddress || !Array.isArray(utxos)) {
      return NextResponse.json(
        { error: "Missing walletAddress or utxos[]" },
        { status: 400 }
      );
    }

    // Coerce to numbers — clients may pass bigint-stringified values
    // from the SDK's U32 scalar.
    const normalized = utxos.map((u) => ({
      treeIndex: Number(u.treeIndex),
      insertionIndex: Number(u.insertionIndex),
    }));

    await markUmbraUtxosClaimed(walletAddress, normalized);
    return NextResponse.json({ marked: normalized.length });
  } catch (err: any) {
    console.error("claimed-utxos POST error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to mark UTXOs claimed" },
      { status: 500 }
    );
  }
}
