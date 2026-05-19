import { NextRequest, NextResponse } from "next/server";

import { isProviderDisabled } from "@/lib/providers";
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

    let result;
    try {
      result = await resolveAutoRoute({
        flow,
        senderAddress: sender,
        receiverAddress: receiver || null,
      });
    } catch (routeErr: any) {
      // resolveAutoRoute throws when every eligible provider is disabled.
      // Surface this honestly so the client can disable Proceed instead
      // of silently routing to a disabled provider.
      return NextResponse.json(
        { providerId: null, unavailable: true, reason: routeErr.message },
        { status: 200 }
      );
    }

    // Belt-and-braces: if the resolved provider somehow ended up disabled
    // (shouldn't happen given the router's checks, but env reads are cheap
    // and a wrong route here is much more expensive than the extra check),
    // mark unavailable.
    if (isProviderDisabled(result.providerId)) {
      return NextResponse.json(
        {
          providerId: null,
          unavailable: true,
          reason: `auto resolved to ${result.providerId} but it is disabled`,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Auto-route preview failed:", err);
    return NextResponse.json(
      { error: `preview-error: ${err.message}` },
      { status: 500 }
    );
  }
}
