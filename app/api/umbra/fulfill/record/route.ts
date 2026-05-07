import { NextRequest, NextResponse } from "next/server";

import {
  claimActivity,
  updateActivityStatus,
  getActivity,
} from "@/lib/database";

/**
 * POST /api/umbra/fulfill/record
 *
 * Records a completed Umbra Request fulfill. The deposit happens
 * client-side via useUmbraFulfill — this endpoint just marks the
 * existing request row as settled and stamps the Umbra tx hashes.
 *
 * Atomic: uses claimActivity() to flip open → processing, then
 * updates to settled. If two payers race, only one wins.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      activityId,
      payerAddress,
      createUtxoSignature,
      createProofAccountSignature,
      closeProofAccountSignature,
    }: {
      activityId: string;
      payerAddress: string;
      createUtxoSignature: string;
      createProofAccountSignature: string;
      closeProofAccountSignature?: string;
    } = body;

    if (!activityId || !payerAddress || !createUtxoSignature) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const existing = await getActivity(activityId);
    if (!existing) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }
    if (existing.type !== "request") {
      return NextResponse.json(
        { error: "Activity is not a request" },
        { status: 400 }
      );
    }

    const claimed = await claimActivity(activityId);
    if (!claimed) {
      return NextResponse.json(
        { error: "Request already fulfilled or cancelled" },
        { status: 409 }
      );
    }

    await updateActivityStatus(activityId, "settled", {
      tx_hash: createUtxoSignature,
      deposit_tx_hash: createProofAccountSignature,
      sender_address: payerAddress,
      provider_id: "umbra",
    });

    return NextResponse.json({
      activityId,
      createUtxoSignature,
      createProofAccountSignature,
      closeProofAccountSignature: closeProofAccountSignature ?? null,
    });
  } catch (err: any) {
    console.error("Umbra fulfill record error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to record fulfill" },
      { status: 500 }
    );
  }
}
