"use client";

/**
 * Resolve the Auto route on the client. Called when the picker is on
 * "Auto" and we know enough state (sender + receiver) to ask the
 * server which protocol Auto would pick.
 *
 * Re-fetches whenever sender/receiver/flow changes. Caller controls
 * whether to fire via the `enabled` flag (e.g. wallet mode gates on
 * isValidAddress, X mode gates on isValidXHandle). Receiver may be null
 * when caller has finished pre-resolution and resolved to nothing
 * (e.g. X handle not in our users table) — server handles null receiver
 * by falling through to MB/PC, so we let the call go through.
 *
 * Returned `resolved` is null while loading; callers should treat that
 * as "we don't know yet" and fall back to a worst-case display.
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
  unavailable: boolean;
}

export function useAutoRoute(args: UseAutoRouteArgs): UseAutoRouteResult {
  const { enabled, flow, senderAddress, receiverAddress } = args;
  const [resolved, setResolved] = useState<ProviderId | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!enabled || !senderAddress) {
      setResolved(null);
      setReason(null);
      setIsLoading(false);
      setUnavailable(false);
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
          providerId: ProviderId | null;
          reason: string;
          unavailable?: boolean;
        };
        if (cancelled) return;
        setResolved(json.providerId);
        setReason(json.reason);
        setUnavailable(!!json.unavailable);
      } catch (err) {
        if (cancelled) return;
        setResolved(null);
        setReason("preview-fetch-error");
        setUnavailable(false);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, flow, senderAddress, receiverAddress]);

  return { resolved, reason, isLoading, unavailable };
}
