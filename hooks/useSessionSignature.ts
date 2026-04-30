"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useWallets } from "@privy-io/react-auth/solana";
import { useCallback, useEffect, useState } from "react";

import type { ProviderId } from "@/lib/providers/types";

// Per-protocol session message + sessionStorage keys.
// Each protocol that needs sender-side burner reclaim ciphertext encryption
// (Send & Claim flows) uses its own message + cache. PC additionally uses its
// sig for PC-protocol UTXO encryption (legacy).
const SESSION_CONFIGS = {
  "privacy-cash": {
    message: "Privacy Money account sign in",
    signatureKey: "pc_session_signature",
    addressKey: "pc_session_address",
  },
  "magicblock-per": {
    message: "Magic Block Swish sign in",
    signatureKey: "mb_session_signature",
    addressKey: "mb_session_address",
  },
  umbra: {
    message: "Umbra Privacy Swish sign in",
    signatureKey: "umbra_session_signature",
    addressKey: "umbra_session_address",
  },
} as const satisfies Record<
  ProviderId,
  { message: string; signatureKey: string; addressKey: string }
>;

// Public exports of the messages so backend routes can verify the sig
// against the right message based on the activity row's provider_id.
export const PC_SESSION_MESSAGE = SESSION_CONFIGS["privacy-cash"].message;
export const MB_SESSION_MESSAGE = SESSION_CONFIGS["magicblock-per"].message;
export const UMBRA_SESSION_MESSAGE = SESSION_CONFIGS.umbra.message;

export function getSessionMessageForProvider(provider: ProviderId): string {
  return SESSION_CONFIGS[provider].message;
}

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

export function useSessionSignature(provider: ProviderId = "privacy-cash") {
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

  // Auto-clear signature on logout
  useEffect(() => {
    if (ready && !authenticated) {
      sessionStorage.removeItem(config.signatureKey);
      sessionStorage.removeItem(config.addressKey);
      setState({
        signature: null,
        address: null,
        isLoading: false,
        error: null,
      });
    }
  }, [ready, authenticated, config.signatureKey, config.addressKey]);

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
// New code should use `getSessionMessageForProvider(providerId)` instead.
export const SESSION_MESSAGE_TEXT = PC_SESSION_MESSAGE;
