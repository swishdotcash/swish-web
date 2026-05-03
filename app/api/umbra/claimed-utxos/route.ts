import { NextRequest, NextResponse } from "next/server";

import { getClaimedUmbraUtxoIds } from "@/lib/database";

/**
 * GET /api/umbra/claimed-utxos?address=<pubkey>
 *
 * Returns IDs of UTXOs the given wallet has already claimed (per our
 * server-side tracker). Clients use this to filter phantoms from
 * Umbra's scanner output.
 *
 * No auth: data is non-sensitive references to public on-chain leaves.
 * See memory/project_umbra_claimed_utxo_tracker.md for the privacy
 * trade-off and cleanup plan when Umbra ships their plugin.
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

    const ids = await getClaimedUmbraUtxoIds(address);
    return NextResponse.json({ ids });
  } catch (err: any) {
    console.error("claimed-utxos GET error:", err);
    // Soft-fail to empty so the UI degrades gracefully (phantoms may
    // appear, but functionality continues) rather than blocking the
    // whole balance read.
    return NextResponse.json({ ids: [], error: err?.message });
  }
}
