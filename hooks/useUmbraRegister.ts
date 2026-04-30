"use client";

/**
 * Client-side Umbra registration hook.
 *
 * Registers the user's wallet on Umbra so they can send/receive private
 * USDC. One-time setup: 1-3 wallet prompts (1 consent signMessage + up to
 * 3 registration txs). Idempotent — calling on an already-registered
 * wallet returns 0 sigs (no-op).
 *
 * For tonight's testing the user pays SOL for registration tx fees and
 * PDA rent (~$9 in rent locked into Umbra's PDAs, permanently). For
 * production we'd want sponsor to be the fee payer + rent payer; that's
 * a follow-up.
 *
 * Required for direct Send / Request fulfill — Umbra's on-chain program
 * verifies the depositor's `EncryptedUserAccount` PDA exists.
 */

import { useCallback, useState } from "react";
import { useStandardWallets, useWallets } from "@privy-io/react-auth/solana";

import {
  getUserAccountQuerierFunction,
  getUserRegistrationFunction,
} from "@umbra-privacy/sdk";

import {
  getBrowserUmbraClient,
  getBrowserUmbraProverSuite,
} from "@/lib/client/umbraClientSDK";
import { createUmbraSignerFromPrivyWallet } from "@/lib/client/umbraPrivySigner";

export type RegisterStage =
  | "idle"
  | "checking"
  | "registering"
  | "done"
  | "already-registered"
  | "error";

interface RegisterState {
  stage: RegisterStage;
  error: string | null;
  detail: string | null;
  txSignatures: string[];
}

export function useUmbraRegister() {
  const { wallets: standardWallets } = useStandardWallets();
  const { wallets: connectedWallets } = useWallets();
  const [state, setState] = useState<RegisterState>({
    stage: "idle",
    error: null,
    detail: null,
    txSignatures: [],
  });

  const register = useCallback(async () => {
    const reset = (next: Partial<RegisterState>) =>
      setState((s) => ({ ...s, ...next }));

    reset({ stage: "checking", error: null, detail: null, txSignatures: [] });

    try {
      const userAddress = connectedWallets[0]?.address;
      if (!userAddress) throw new Error("No wallet connected");

      const stdWallet = standardWallets.find((w: any) =>
        w.accounts.some((a: any) => a.address === userAddress)
      );
      if (!stdWallet) throw new Error("No wallet-standard wallet found");
      const stdAccount = stdWallet.accounts.find(
        (a: any) => a.address === userAddress
      );
      if (!stdAccount) throw new Error("No wallet-standard account found");

      const signer = createUmbraSignerFromPrivyWallet(stdWallet, stdAccount);

      const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
      if (!rpcUrl) throw new Error("NEXT_PUBLIC_RPC_URL not set");

      const client = await getBrowserUmbraClient({ signer, rpcUrl });

      // Quick check first — skip prompts if already registered
      const query = getUserAccountQuerierFunction({ client });
      const existing = await query(userAddress as any);
      if (
        existing.state === "exists" &&
        (existing.data as any).x25519PublicKey &&
        (existing.data as any).userCommitment
      ) {
        reset({
          stage: "already-registered",
          detail: "Wallet was already registered on Umbra",
        });
        return [] as string[];
      }

      reset({
        stage: "registering",
        detail:
          "Sign each prompt to enable Umbra (one-time setup, 1-3 prompts)",
      });

      const suite = getBrowserUmbraProverSuite();
      const registerFn = getUserRegistrationFunction(
        { client },
        { zkProver: suite.registration }
      );
      const sigs = await registerFn({
        confidential: true,
        anonymous: true,
      });

      const sigStrings = sigs.map((s) => s.toString());
      reset({
        stage: "done",
        detail: `Registered with ${sigStrings.length} txs`,
        txSignatures: sigStrings,
      });
      return sigStrings;
    } catch (err: any) {
      const parts: string[] = [];
      let cur = err;
      while (cur) {
        if (cur.message) parts.push(cur.message);
        if (cur.context?.logs) {
          parts.push("Logs:\n" + (cur.context.logs as string[]).join("\n"));
        }
        cur = cur.cause;
      }
      // eslint-disable-next-line no-console
      console.error("[useUmbraRegister] error:", err);
      reset({
        stage: "error",
        error: parts.join("\n\n---\n\n") || err?.message || String(err),
      });
      throw err;
    }
  }, [standardWallets, connectedWallets]);

  return {
    register,
    state,
    isLoading: state.stage === "checking" || state.stage === "registering",
  };
}
