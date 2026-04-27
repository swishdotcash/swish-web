"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useWallets } from "@privy-io/react-auth/solana";
import { useCallback, useEffect, useState } from "react";

const PC_SESSION_SIGNATURE_KEY = "pc_session_signature";
const PC_SESSION_ADDRESS_KEY = "pc_session_address";
// Must match privacycash SDK's message for encryption key derivation
const SESSION_MESSAGE = "Privacy Money account sign in";

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

export function useSessionSignature() {
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

    const storedSignature = sessionStorage.getItem(PC_SESSION_SIGNATURE_KEY);
    const storedAddress = sessionStorage.getItem(PC_SESSION_ADDRESS_KEY);

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
  }, [ready, walletAddress]);

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
        const messageBytes = new TextEncoder().encode(SESSION_MESSAGE);

        const { signature: signatureBytes } = await signMessage({
          message: messageBytes,
          wallet,
        });

        const signatureBase64 = btoa(String.fromCharCode(...signatureBytes));

        sessionStorage.setItem(PC_SESSION_SIGNATURE_KEY, signatureBase64);
        sessionStorage.setItem(PC_SESSION_ADDRESS_KEY, wallet.address);

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
    }, [walletAddress, wallets, signMessage]);

  // Lazy fetch: returns existing sig from sessionStorage if present (and matching
  // the current wallet), otherwise prompts the user to sign now. Reads sessionStorage
  // directly so it stays correct even if multiple hook instances drift.
  const getSignature =
    useCallback(async (): Promise<SessionSignatureResult | null> => {
      const stored = sessionStorage.getItem(PC_SESSION_SIGNATURE_KEY);
      const storedAddr = sessionStorage.getItem(PC_SESSION_ADDRESS_KEY);
      if (stored && storedAddr && walletAddress === storedAddr) {
        return { signature: stored, address: storedAddr };
      }
      return requestSignature();
    }, [walletAddress, requestSignature]);

  // Auto-clear signature on logout
  useEffect(() => {
    if (ready && !authenticated) {
      sessionStorage.removeItem(PC_SESSION_SIGNATURE_KEY);
      sessionStorage.removeItem(PC_SESSION_ADDRESS_KEY);
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
    sessionStorage.removeItem(PC_SESSION_SIGNATURE_KEY);
    sessionStorage.removeItem(PC_SESSION_ADDRESS_KEY);
    setState({
      signature: null,
      address: null,
      isLoading: false,
      error: null,
    });
  }, []);

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

// Export the message for backend verification
export const SESSION_MESSAGE_TEXT = SESSION_MESSAGE;
