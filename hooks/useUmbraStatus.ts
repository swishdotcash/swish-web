"use client";

/**
 * Check whether the current user's wallet is registered on Umbra.
 *
 * Auto-fetches on mount + when wallet address changes. Returns
 * `registered: true | false | null` where null = still loading or no
 * wallet connected.
 *
 * Used by:
 *   - Profile registration toggle (preset state)
 *   - Send picker UI (gate Umbra option for unregistered senders)
 *   - Smoke test page (display registered/not status)
 */

import { useCallback, useEffect, useState } from "react";
import { useWallets } from "@privy-io/react-auth/solana";

export type UmbraStatus = "loading" | "registered" | "unregistered" | "no-wallet" | "error";

export function useUmbraStatus() {
  const { wallets } = useWallets();
  const address = wallets[0]?.address ?? null;

  const [status, setStatus] = useState<UmbraStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!address) {
      setStatus("no-wallet");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(
        `/api/umbra/status?address=${encodeURIComponent(address)}`
      );
      if (!res.ok) {
        throw new Error(`status check failed: HTTP ${res.status}`);
      }
      const json = (await res.json()) as { registered: boolean };
      setStatus(json.registered ? "registered" : "unregistered");
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setStatus("error");
    }
  }, [address]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    status,
    address,
    error,
    refetch,
    isRegistered: status === "registered",
  };
}
