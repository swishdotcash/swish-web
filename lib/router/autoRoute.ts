/**
 * Auto router: given a flow + sender + receiver, picks which provider to
 * dispatch. Server-side only (does Supabase reads + outbound /health probes).
 *
 * Rules (locked 2026-05-02):
 *   send, fulfill:
 *     both sender + receiver Umbra-registered  → umbra
 *     else, MB live                            → magicblock-per
 *     else                                     → privacy-cash (last resort)
 *   send_claim:
 *     MB live                                  → magicblock-per
 *     else                                     → privacy-cash
 *
 * Liveness is a 30s-cached `/health` probe — best-effort, doesn't catch
 * partial outages where /health is ok but /transfer 405s. Client-side
 * dispatch retry handles those cases by falling back MB→PC after a
 * failed prepare.
 *
 * Why never auto-pick Umbra for send_claim: the burner SC pattern adds
 * 0.7% claim fee + extra failure modes without giving the recipient any
 * privacy benefit (they get USDC in their ATA either way). Umbra is
 * dropped from the SC picker entirely.
 */

import type { ProviderId } from "@/lib/providers/types";
import { isProviderDisabled } from "@/lib/providers/maintenance";
import { isAddressRegisteredOnUmbra } from "@/lib/sponsor/umbraBurner";

export type AutoFlow = "send" | "fulfill" | "send_claim";

export interface AutoRouteContext {
  flow: AutoFlow;
  senderAddress: string;
  receiverAddress: string | null;
}

export interface AutoRouteResult {
  providerId: ProviderId;
  reason: string;
}

const MB_HEALTH_URL = "https://payments.magicblock.app/health";
const HEALTH_CACHE_TTL_MS = 30_000;
let mbHealthCache: { ok: boolean; at: number } | null = null;

async function isMagicBlockLive(): Promise<boolean> {
  const now = Date.now();
  if (mbHealthCache && now - mbHealthCache.at < HEALTH_CACHE_TTL_MS) {
    return mbHealthCache.ok;
  }
  try {
    const res = await fetch(MB_HEALTH_URL, {
      signal: AbortSignal.timeout(2000),
    });
    const ok = res.ok;
    mbHealthCache = { ok, at: now };
    return ok;
  } catch {
    mbHealthCache = { ok: false, at: now };
    return false;
  }
}

export async function resolveAutoRoute(
  ctx: AutoRouteContext
): Promise<AutoRouteResult> {
  const umbraDisabled = isProviderDisabled("umbra");
  const mbDisabled = isProviderDisabled("magicblock-per");
  const pcDisabled = isProviderDisabled("privacy-cash");

  // SC never routes through Umbra; only MB-or-PC for SC.
  if (ctx.flow === "send_claim") {
    if (!mbDisabled) {
      const mbLive = await isMagicBlockLive();
      if (mbLive) {
        return { providerId: "magicblock-per", reason: "send_claim → mb (live)" };
      }
    }
    if (!pcDisabled) {
      return { providerId: "privacy-cash", reason: "send_claim → pc (mb unavailable)" };
    }
    throw new Error("No provider available for send_claim (all disabled or down)");
  }

  // For send/fulfill, check Umbra eligibility first (registration is the
  // dominant gate — falls through to MB/PC if either side isn't on Umbra).
  if (!umbraDisabled && ctx.receiverAddress) {
    const [senderRegistered, receiverRegistered] = await Promise.all([
      isAddressRegisteredOnUmbra(ctx.senderAddress).catch(() => false),
      isAddressRegisteredOnUmbra(ctx.receiverAddress).catch(() => false),
    ]);

    if (senderRegistered && receiverRegistered) {
      return { providerId: "umbra", reason: "both umbra-registered" };
    }
  }

  // Neither side eligible for Umbra (or receiver unknown — e.g. X-handle
  // pre-resolve). Pick MB if live, else PC.
  if (!mbDisabled) {
    const mbLive = await isMagicBlockLive();
    if (mbLive) {
      return { providerId: "magicblock-per", reason: "umbra ineligible → mb (live)" };
    }
  }
  if (!pcDisabled) {
    return { providerId: "privacy-cash", reason: "umbra ineligible → pc (mb unavailable)" };
  }
  throw new Error("No provider available (all disabled or down)");
}
