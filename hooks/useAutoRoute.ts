"use client";

/**
 * Resolve the Auto route on the client. Called when the picker is on
 * "Auto" and we know enough state (sender + receiver) to ask the
 * server which protocol Auto would pick.
 *
 * Re-fetches whenever sender/receiver/flow changes. Skips entirely if
 * receiver is null (e.g. X-handle pre-resolve in SendModal — Auto
 * resolves at proceed time inside the dispatch flow instead).
 *
 * Returned `resolved` is null while loading or when inputs are
 * incomplete; callers should treat that as "we don't know yet" and
 * either wait or fall back to a worst-case display.
 */

import { useEffect, useState } from "react";

import type { ProviderId } from "@/lib/providers/types";
import type { AutoFlow } from "@/lib/router/autoRoute";

interface UseAutoRouteArgs {
  enabled: boolean;
  flow: AutoFlow;
  senderAddress: string | null;
  receiverAddress: string | null;
}

interface UseAutoRouteResult {
  resolved: ProviderId | null;
  reason: string | null;
  isLoading: boolean;
}

export function useAutoRoute(args: UseAutoRouteArgs): UseAutoRouteResult {
  const { enabled, flow, senderAddress, receiverAddress } = args;
  const [resolved, setResolved] = useState<ProviderId | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // send_claim has no receiver at sender time (recipient comes from the
    // link). Other flows still require a receiver.
    const receiverOk = flow === "send_claim" || !!receiverAddress;
    if (!enabled || !senderAddress || !receiverOk) {
      setResolved(null);
      setReason(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const url =
          `/api/router/preview?flow=${encodeURIComponent(flow)}` +
          `&sender=${encodeURIComponent(senderAddress)}` +
          (receiverAddress
            ? `&receiver=${encodeURIComponent(receiverAddress)}`
            : "");
        const res = await fetch(url);
        const json = (await res.json()) as {
          providerId: ProviderId;
          reason: string;
        };
        if (cancelled) return;
        setResolved(json.providerId);
        setReason(json.reason);
      } catch (err) {
        if (cancelled) return;
        // Graceful degrade — fall through to MB so the modal can proceed.
        setResolved("magicblock-per");
        setReason("preview-fetch-error");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, flow, senderAddress, receiverAddress]);

  return { resolved, reason, isLoading };
}
