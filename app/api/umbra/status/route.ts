import { NextRequest, NextResponse } from "next/server";

import { isAddressRegisteredOnUmbra } from "@/lib/sponsor/umbraBurner";

/**
 * GET /api/umbra/status?address=<pubkey>
 *
 * Returns whether the given Solana address is registered on Umbra. Used by:
 *   - Router rule 2 pre-flight check before allowing direct Send via Umbra
 *   - Profile toggle to preset state ("Registered ✓") if user is already on
 *     Umbra
 *
 * Pure read — no signature, no on-chain action, no rate-limit needed beyond
 * indexer's own.
 */
export async function GET(request: NextRequest) {
  try {
    const address = request.nextUrl.searchParams.get("address");
    if (!address) {
      return NextResponse.json(
        { error: "Missing address query param" },
        { status: 400 }
      );
    }

    const registered = await isAddressRegisteredOnUmbra(address);
    return NextResponse.json({ registered });
  } catch (err: any) {
    console.error("Umbra status check failed:", err);
    // Don't crash callers — return registered: false on error so router
    // gracefully degrades to non-Umbra options.
    return NextResponse.json({ registered: false, error: err.message });
  }
}
