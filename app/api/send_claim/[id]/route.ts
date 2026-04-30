import { NextRequest, NextResponse } from "next/server";

import { getActivity } from "@/lib/database";
import { TOKEN_MINTS, TokenType } from "@/lib/privacycash/tokens";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get wallet address from query param (optional)
    const walletAddress = request.nextUrl.searchParams.get("wallet");

    const activity = await getActivity(id);
    if (!activity) {
      return NextResponse.json({ error: "Claim link not found" }, { status: 404 });
    }

    if (activity.type !== "send_claim") {
      return NextResponse.json({ error: "Not a claim link" }, { status: 400 });
    }

    // Determine token
    let token: TokenType = "USDC";
    if (activity.token_address === TOKEN_MINTS.SOL.toBase58()) {
      token = "SOL";
    } else if (activity.token_address === TOKEN_MINTS.USDT.toBase58()) {
      token = "USDT";
    }

    // Check if requester is the sender (for reclaim detection)
    const isSender = walletAddress
      ? walletAddress.toLowerCase() === activity.sender_address?.toLowerCase()
      : false;

    // Return public info only (no sensitive data)
    return NextResponse.json({
      id: activity.id,
      amount: activity.amount,
      token,
      status: activity.status,
      message: activity.message,
      createdAt: activity.created_at,
      isSender,
      providerId: activity.provider_id,
      // Don't expose sender_address, burner_address, or encrypted data
    });
  } catch (error: any) {
    console.error("Get claim link error:", error);

    return NextResponse.json(
      { error: error.message ?? "Failed to get claim link" },
      { status: 500 }
    );
  }
}
