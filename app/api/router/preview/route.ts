import { NextRequest, NextResponse } from "next/server";

import { resolveAutoRoute, type AutoFlow } from "@/lib/router/autoRoute";

const VALID_FLOWS: AutoFlow[] = ["send", "fulfill", "send_claim"];

/**
 * GET /api/router/preview?flow=send&sender=<addr>&receiver=<addr>
 *
 * Returns the providerId Auto would dispatch to, plus a one-liner reason
 * for the UI to surface ("Routed via X" line) and for telemetry.
 *
 * Pure read (registration state from chain, no on-chain writes). No auth
 * needed — it doesn't reveal anything not already inferable from the
 * Umbra registration table.
 */
export async function GET(request: NextRequest) {
  try {
    const flow = request.nextUrl.searchParams.get("flow") as AutoFlow | null;
    const sender = request.nextUrl.searchParams.get("sender");
    const receiver = request.nextUrl.searchParams.get("receiver");

    if (!flow || !VALID_FLOWS.includes(flow)) {
      return NextResponse.json(
        { error: `Invalid flow. Expected one of: ${VALID_FLOWS.join(", ")}` },
        { status: 400 }
      );
    }

    if (!sender) {
      return NextResponse.json(
        { error: "Missing sender query param" },
        { status: 400 }
      );
    }

    const result = await resolveAutoRoute({
      flow,
      senderAddress: sender,
      receiverAddress: receiver || null,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Auto-route preview failed:", err);
    // Graceful degrade — pick MB as the safe default so the modal can
    // still proceed even if our preview path fails.
    return NextResponse.json(
      { providerId: "magicblock-per", reason: `preview-error: ${err.message}` },
      { status: 200 }
    );
  }
}
