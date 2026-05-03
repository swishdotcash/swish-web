"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useWallets } from "@privy-io/react-auth/solana";
import { useCallback, useEffect, useState } from "react";

import type { ProviderId } from "@/lib/providers/types";
import {
  PC_SESSION_MESSAGE,
  MB_SESSION_MESSAGE,
  UMBRA_SESSION_MESSAGE,
  REQUEST_SESSION_MESSAGE,
} from "@/lib/session-messages";

// Session contexts: protocol-specific (PC/MB/Umbra — for protocol crypto
// or burner reclaim ciphertext) plus protocol-agnostic ("request" — for
// Request create + cancel auth, since at request time the protocol isn't
// yet chosen).
export type SessionContext = ProviderId | "request";

const SESSION_CONFIGS = {
  "privacy-cash": {
    message: PC_SESSION_MESSAGE,
    signatureKey: "pc_session_signature",
    addressKey: "pc_session_address",
  },
  "magicblock-per": {
    message: MB_SESSION_MESSAGE,
    signatureKey: "mb_session_signature",
    addressKey: "mb_session_address",
  },
  umbra: {
    message: UMBRA_SESSION_MESSAGE,
    signatureKey: "umbra_session_signature",
    addressKey: "umbra_session_address",
  },
  request: {
    message: REQUEST_SESSION_MESSAGE,
    signatureKey: "request_session_signature",
    addressKey: "request_session_address",
  },
} as const satisfies Record<
  SessionContext,
  { message: string; signatureKey: string; addressKey: string }
>;

interface SessionSignatureState {
  signature: string | null;
  address: string | null;
  isLoading: boolean;
  error: string | null;
}

export type SessionSignatureResult = {
  signature: string;
  address: string;
};

export type GetSessionSignature = () => Promise<SessionSignatureResult | null>;

export function useSessionSignature(provider: SessionContext = "privacy-cash") {
  const config = SESSION_CONFIGS[provider];
  const { authenticated, ready, user } = usePrivy();
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();

  const [state, setState] = useState<SessionSignatureState>({
    signature: null,
    address: null,
    isLoading: true,
    error: null,
  });

  // For Twitter users, ONLY use the embedded wallet — never fall back to external wallets (e.g. Phantom)
  const isTwitterUser = !!user?.twitter;
  const userWalletAddress = user?.wallet?.address;
  const embeddedWallet = wallets.find(
    (w) =>
      (w as any).walletClientType === "privy" ||
      (userWalletAddress && w.address === userWalletAddress)
  );
  const solanaWallet = isTwitterUser
    ? embeddedWallet || null
    : wallets[0] || null;

  // Stable reference to current wallet address
  const walletAddress = solanaWallet?.address || null;

  // Hydrate state from sessionStorage on mount and when wallet changes.
  // No auto-prompt — getSignature() triggers the wallet prompt lazily at action time.
  useEffect(() => {
    if (!ready) return;

    const storedSignature = sessionStorage.getItem(config.signatureKey);
    const storedAddress = sessionStorage.getItem(config.addressKey);

    if (storedSignature && storedAddress && walletAddress === storedAddress) {
      setState({
        signature: storedSignature,
        address: storedAddress,
        isLoading: false,
        error: null,
      });
      return;
    }

    setState({
      signature: null,
      address: null,
      isLoading: false,
      error: null,
    });
  }, [ready, walletAddress, config.signatureKey, config.addressKey]);

  // Request signature from user — stabilized with walletAddress string dep
  const requestSignature =
    useCallback(async (): Promise<SessionSignatureResult | null> => {
      // Find the wallet at call time to avoid stale closure
      const wallet = wallets.find((w) => w.address === walletAddress);
      if (!wallet) {
        setState((prev) => ({ ...prev, error: "No wallet connected" }));
        return null;
      }

      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const messageBytes = new TextEncoder().encode(config.message);

        const { signature: signatureBytes } = await signMessage({
          message: messageBytes,
          wallet,
        });

        const signatureBase64 = btoa(String.fromCharCode(...signatureBytes));

        sessionStorage.setItem(config.signatureKey, signatureBase64);
        sessionStorage.setItem(config.addressKey, wallet.address);

        setState({
          signature: signatureBase64,
          address: wallet.address,
          isLoading: false,
          error: null,
        });

        return { signature: signatureBase64, address: wallet.address };
      } catch (error: any) {
        console.error("Failed to get signature:", error);
        setState({
          signature: null,
          address: null,
          isLoading: false,
          error: error.message || "Failed to sign message",
        });
        return null;
      }
    }, [
      walletAddress,
      wallets,
      signMessage,
      config.message,
      config.signatureKey,
      config.addressKey,
    ]);

  // Lazy fetch: returns existing sig from sessionStorage if present (and matching
  // the current wallet), otherwise prompts the user to sign now. Reads sessionStorage
  // directly so it stays correct even if multiple hook instances drift.
  const getSignature =
    useCallback(async (): Promise<SessionSignatureResult | null> => {
      const stored = sessionStorage.getItem(config.signatureKey);
      const storedAddr = sessionStorage.getItem(config.addressKey);
      if (stored && storedAddr && walletAddress === storedAddr) {
        return { signature: stored, address: storedAddr };
      }
      return requestSignature();
    }, [
      walletAddress,
      requestSignature,
      config.signatureKey,
      config.addressKey,
    ]);

  // Auto-clear ALL session signatures on logout, not just this instance's
  // key. Hook instances mounted in modals (MB / Umbra / Request) unmount
  // before logout fires, so each instance must clean up everything to
  // guarantee no stale sigs persist for the next user. Also wipes the
  // Umbra master seed cache (sessionStorage `umbra_master_seed:<addr>`)
  // since that's user-specific too.
  useEffect(() => {
    if (ready && !authenticated) {
      for (const cfg of Object.values(SESSION_CONFIGS)) {
        sessionStorage.removeItem(cfg.signatureKey);
        sessionStorage.removeItem(cfg.addressKey);
      }
      // Umbra master seeds are keyed `umbra_master_seed:<address>` —
      // sweep all matching entries.
      const toRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith("umbra_master_seed:")) toRemove.push(k);
      }
      for (const k of toRemove) sessionStorage.removeItem(k);
      setState({
        signature: null,
        address: null,
        isLoading: false,
        error: null,
      });
    }
  }, [ready, authenticated]);

  // Clear signature (manual)
  const clearSignature = useCallback(() => {
    sessionStorage.removeItem(config.signatureKey);
    sessionStorage.removeItem(config.addressKey);
    setState({
      signature: null,
      address: null,
      isLoading: false,
      error: null,
    });
  }, [config.signatureKey, config.addressKey]);

  // Helper to get headers for API calls — only returns truthy when a sig is already cached
  const getAuthHeaders = useCallback(() => {
    if (!state.signature || !state.address) {
      return null;
    }
    return {
      "X-Session-Signature": state.signature,
      "X-Wallet-Address": state.address,
    };
  }, [state.signature, state.address]);

  return {
    ...state,
    requestSignature,
    getSignature,
    clearSignature,
    getAuthHeaders,
    isAuthenticated: authenticated,
    walletAddress: walletAddress || userWalletAddress || null,
  };
}

// Backward-compat export for callers that import the PC message text directly.
// New code should use `getSessionMessageForProvider(providerId)` from
// `@/lib/session-messages` instead.
export { PC_SESSION_MESSAGE, MB_SESSION_MESSAGE, UMBRA_SESSION_MESSAGE };
export const SESSION_MESSAGE_TEXT = PC_SESSION_MESSAGE;
