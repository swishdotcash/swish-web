import { NextRequest, NextResponse } from "next/server";

import { TOKEN_MINTS } from "@/lib/privacycash/tokens";
import { createActivity } from "@/lib/database";

/**
 * POST /api/umbra/send/record
 *
 * Records a completed Umbra direct Send. The actual deposit happens
 * client-side (see hooks/useUmbraSend.ts) — this endpoint just persists
 * an activity row so it shows up in the user's history. No funds at
 * stake.
 *
 * Authentication: trusts the client's reported sender address. The
 * deposit txs are signed by that wallet and on-chain — anyone could
 * "claim credit" for someone else's tx, but at worst they'd be claiming
 * a tx that already exists on-chain. Low risk for a history UI.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      senderAddress,
      receiverAddress,
      amountBaseUnits,
      message,
      createUtxoSignature,
      createProofAccountSignature,
      closeProofAccountSignature,
    }: {
      senderAddress: string;
      receiverAddress: string;
      amountBaseUnits: string;
      message?: string;
      createUtxoSignature: string;
      createProofAccountSignature: string;
      closeProofAccountSignature?: string;
    } = body;

    if (!senderAddress || !receiverAddress || !amountBaseUnits || !createUtxoSignature) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // USDC has 6 decimals. Convert base units back to display amount.
    const amountFloat = Number(BigInt(amountBaseUnits)) / 1_000_000;

    const activity = await createActivity({
      type: "send",
      sender_address: senderAddress,
      receiver_address: receiverAddress,
      amount: amountFloat,
      token_address: TOKEN_MINTS.USDC.toBase58(),
      status: "settled",
      message: message || null,
      tx_hash: createUtxoSignature,
      provider_id: "umbra",
      // For audit + future debugging: capture the full multi-tx
      // signature set in the deposit_tx_hash field. The createUtxo
      // signature is the canonical settlement; the others are
      // reference-only.
      deposit_tx_hash: createProofAccountSignature,
    });

    return NextResponse.json({
      activityId: activity.id,
      createUtxoSignature,
      createProofAccountSignature,
      closeProofAccountSignature: closeProofAccountSignature ?? null,
    });
  } catch (err: any) {
    console.error("Umbra send record error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to record send" },
      { status: 500 }
    );
  }
}
