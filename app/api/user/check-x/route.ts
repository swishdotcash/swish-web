import { NextRequest, NextResponse } from "next/server";

import { getUserByTwitterHandle } from "@/lib/database";
import { isAddressRegisteredOnUmbra } from "@/lib/sponsor/umbraBurner";

/**
 * GET /api/user/check-x?handle=<handle>
 *
 * Read-only X-handle resolution for SendModal pre-proceed routing.
 * Returns whether the handle is in our users table, the wallet address
 * if so, and whether that wallet is currently registered on Umbra.
 *
 * Distinct from /api/user/resolve-x: this endpoint NEVER provisions a
 * Privy embedded wallet. Used in the X-mode debounce so we can drive
 * picker gating + Auto routing without side effects on every keystroke.
 *
 * Response:
 *   { exists: boolean, walletAddress: string | null, umbraRegistered: boolean }
 */
export async function GET(request: NextRequest) {
  try {
    const handle = request.nextUrl.searchParams.get("handle");
    if (!handle) {
      return NextResponse.json(
        { error: "Missing handle query param" },
        { status: 400 }
      );
    }

    const normalized = handle.replace(/^@/, "").toLowerCase();
    const user = await getUserByTwitterHandle(normalized);

    if (!user) {
      return NextResponse.json({
        exists: false,
        walletAddress: null,
        umbraRegistered: false,
      });
    }

    const umbraRegistered = await isAddressRegisteredOnUmbra(
      user.wallet_address
    ).catch(() => false);

    return NextResponse.json({
      exists: true,
      walletAddress: user.wallet_address,
      umbraRegistered,
    });
  } catch (err: any) {
    console.error("check-x failed:", err);
    return NextResponse.json(
      { error: err.message || "check-x failed" },
      { status: 500 }
    );
  }
}
