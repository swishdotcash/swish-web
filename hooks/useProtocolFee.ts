"use client";

/**
 * Compute the protocol-specific fee for a given Send/Fulfill/Send & Claim
 * action. Wraps `lib/fees.ts` and pulls PC's dynamic base fee from the
 * existing /api/fee endpoint via useFee.
 *
 * Fee shown depends on the picked protocol — PC has a $0.71-ish base +
 * 0.35%, MB is effectively free, Umbra direct is free, Umbra SC is 0.7%
 * (recipient-paid on claim).
 */

import { useFee } from "./useFee";
import { estimateFee, type FeeEstimate, type FlowKind } from "@/lib/fees";
import type { ProviderId } from "@/lib/providers/types";

export function useProtocolFee(
  provider: ProviderId | "auto",
  amount: number,
  flow: FlowKind
): FeeEstimate & { isLoading: boolean } {
  const { baseFee, isLoading } = useFee();
  const estimate = estimateFee(provider, amount, flow, baseFee);
  return { ...estimate, isLoading };
}
