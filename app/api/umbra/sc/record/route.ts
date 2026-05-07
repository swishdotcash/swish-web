import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { recordUmbraScDeposit } from "@/lib/sponsor/umbraSendClaim";

/**
 * POST /api/umbra/sc/record
 *
 * Client posts after completing the Umbra Direct Send to the burner.
 * Server transitions the activity row from `processing` → `open`
 * (claimable by recipient) and returns the claim link.
 *
 * No signature check on the body: the activity row was created by the
 * sender via /api/umbra/sc/prepare (which DID verify session sig).
 * We re-verify the sender by matching senderPublicKey against the
 * row's sender_address. Worst case if someone spoofs: they can only
 * "complete" a row that already belongs to that sender — the on-chain
 * UTXO either exists or it doesn't.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      activityId,
      senderPublicKey,
      createUtxoSignature,
      createProofAccountSignature,
      closeProofAccountSignature,
    }: {
      activityId: string;
      senderPublicKey: string;
      createUtxoSignature: string;
      createProofAccountSignature: string;
      closeProofAccountSignature?: string;
    } = body;

    if (
      !activityId ||
      !senderPublicKey ||
      !createUtxoSignature ||
      !createProofAccountSignature
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: activityId, senderPublicKey, createUtxoSignature, createProofAccountSignature",
        },
        { status: 400 }
      );
    }

    const result = await recordUmbraScDeposit({
      activityId,
      senderPublicKey: new PublicKey(senderPublicKey),
      createUtxoSignature,
      createProofAccountSignature,
      closeProofAccountSignature,
    });

    return NextResponse.json({
      activityId: result.activityId,
      claimLink: result.claimLink,
      burnerAddress: result.burnerAddress,
    });
  } catch (err: any) {
    console.error("Umbra SC record error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to record Umbra SC deposit" },
      { status: 500 }
    );
  }
}
