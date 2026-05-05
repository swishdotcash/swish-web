"use client";

/**
 * Client-side Umbra Send & Claim hook (flipped burner pattern).
 *
 * Flow:
 *   1. Call /api/umbra/sc/prepare → server provisions a fresh burner,
 *      registers it on Umbra (sponsored), persists activity row in
 *      `processing` state. Returns burner address + passphrase.
 *   2. Run Umbra Direct Send to the burner's address using the user's
 *      embedded wallet as IUmbraSigner (3 wallet prompts: 1 consent
 *      signMessage + 2 deposit signTransactions). Same SDK call as
 *      `useUmbraSend`, just targeting the per-SC burner.
 *   3. Call /api/umbra/sc/record → server marks activity `open`,
 *      returns the claim link.
 *
 * Sender on-chain trace becomes `sender → Umbra pool` (no visible
 * intermediate burner ATA), which is the privacy upgrade vs the old
 * "sender SPL → burner → server-side Umbra deposit" pattern.
 *
 * Mirrors `useUmbraSend.ts`. Keep them in sync if either changes.
 */

import { useCallback, useState } from "react";
import { useStandardWallets, useWallets } from "@privy-io/react-auth/solana";

import {
  getPublicBalanceToReceiverClaimableUtxoCreatorFunction,
  getUserAccountQuerierFunction,
} from "@umbra-privacy/sdk";
import type { ZkProverForReceiverClaimableUtxoFromPublicBalance } from "@umbra-privacy/sdk/interfaces";

import {
  getBrowserUmbraClient,
  getBrowserUmbraProverSuite,
} from "@/lib/client/umbraClientSDK";
import { createUmbraSignerFromPrivyWallet } from "@/lib/client/umbraPrivySigner";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type UmbraSendClaimStage =
  | "idle"
  | "preparing-burner"
  | "constructing-client"
  | "checking-burner"
  | "depositing"
  | "recording"
  | "settled"
  | "error";

export interface UmbraSendClaimParams {
  amount: number; // display amount, e.g. 1.5 USDC
  message?: string;
  sessionSignature: string; // base64-encoded Umbra session sig (verified by server)
  senderPublicKey: string;
}

export interface UmbraSendClaimResult {
  activityId: string;
  burnerAddress: string;
  passphrase: string;
  claimLink: string;
  createUtxoSignature: string;
  createProofAccountSignature: string;
  closeProofAccountSignature?: string;
}

interface UmbraSendClaimState {
  stage: UmbraSendClaimStage;
  error: string | null;
  detail: string | null;
}

export function useUmbraSendClaim() {
  const { wallets: standardWallets } = useStandardWallets();
  const { wallets: connectedWallets } = useWallets();
  const [state, setState] = useState<UmbraSendClaimState>({
    stage: "idle",
    error: null,
    detail: null,
  });

  const sendClaim = useCallback(
    async (params: UmbraSendClaimParams): Promise<UmbraSendClaimResult> => {
      const reset = (next: Partial<UmbraSendClaimState>) =>
        setState((s) => ({ ...s, ...next }));

      reset({ stage: "preparing-burner", error: null, detail: null });

      try {
        // Stage 1: server provisions burner + registers on Umbra. Takes
        // ~10-20s end-to-end (sponsor SOL top-up + Umbra registration).
        const prepareRes = await fetch("/api/umbra/sc/prepare", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Session-Signature": params.sessionSignature,
          },
          body: JSON.stringify({
            senderPublicKey: params.senderPublicKey,
            amount: params.amount,
            token: "USDC",
            message: params.message,
          }),
        });
        if (!prepareRes.ok) {
          const json = await prepareRes.json().catch(() => ({}));
          throw new Error(json.error || "Failed to prepare Umbra SC burner");
        }
        const { activityId, burnerAddress, passphrase } =
          (await prepareRes.json()) as {
            activityId: string;
            burnerAddress: string;
            passphrase: string;
          };

        // Stage 2: construct the Umbra browser client with user's
        // wallet as IUmbraSigner. Same pattern as useUmbraSend.
        reset({ stage: "constructing-client", detail: null });

        const userAddress = connectedWallets[0]?.address;
        if (!userAddress) throw new Error("No wallet connected");
        if (userAddress !== params.senderPublicKey) {
          throw new Error("Wallet address mismatch with session sig");
        }

        const stdWallet = standardWallets.find((w: any) =>
          w.accounts.some((a: any) => a.address === userAddress)
        );
        if (!stdWallet) {
          throw new Error("Could not find wallet-standard wallet for current user");
        }
        const stdAccount = stdWallet.accounts.find(
          (a: any) => a.address === userAddress
        );
        if (!stdAccount) {
          throw new Error("Could not find wallet-standard account");
        }
        const signer = createUmbraSignerFromPrivyWallet(stdWallet, stdAccount);

        const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
        if (!rpcUrl) throw new Error("NEXT_PUBLIC_RPC_URL not set");

        const client = await getBrowserUmbraClient({ signer, rpcUrl });

        // Stage 3: pre-flight check that burner is fully registered on
        // Umbra. Server just registered it, but Arcium MPC settlement
        // for RegisterUserForAnonymousUsageV11 is async — give it a
        // few retries before failing.
        reset({ stage: "checking-burner", detail: burnerAddress });
        const query = getUserAccountQuerierFunction({ client });
        const POLL_INTERVAL_MS = 2_000;
        const POLL_TIMEOUT_MS = 30_000;
        const start = Date.now();
        let burnerReady = false;
        while (!burnerReady && Date.now() - start < POLL_TIMEOUT_MS) {
          const recipientState = await query(burnerAddress as any);
          const recipientData = (recipientState as any).data;
          burnerReady =
            recipientState.state === "exists" &&
            Boolean(
              recipientData?.x25519PublicKey && recipientData?.userCommitment
            );
          if (!burnerReady) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          }
        }
        if (!burnerReady) {
          throw new Error(
            "Burner registration didn't finalize in time. Try again in a moment."
          );
        }

        // Stage 4: Umbra Direct Send to burner. SDK triggers 1 consent
        // (signMessage) then 2 deposit txs (signTransaction). User
        // sees 3 wallet prompts.
        reset({
          stage: "depositing",
          detail: "Sign each prompt to complete the private send (~3 prompts)",
        });

        const suite = getBrowserUmbraProverSuite();
        const deposit = getPublicBalanceToReceiverClaimableUtxoCreatorFunction(
          { client },
          {
            zkProver:
              suite.utxoReceiverClaimable as unknown as ZkProverForReceiverClaimableUtxoFromPublicBalance,
          }
        );

        const amountBaseUnits = BigInt(Math.floor(params.amount * 1_000_000));
        const result = await deposit({
          amount: amountBaseUnits as any,
          destinationAddress: burnerAddress as any,
          mint: USDC_MINT as any,
        });

        // Stage 5: tell the server the deposit landed → server flips
        // activity row to `open` and returns claim link.
        reset({ stage: "recording", detail: null });
        const recordRes = await fetch("/api/umbra/sc/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            activityId,
            senderPublicKey: params.senderPublicKey,
            createUtxoSignature: result.createUtxoSignature.toString(),
            createProofAccountSignature:
              result.createProofAccountSignature.toString(),
            closeProofAccountSignature:
              result.closeProofAccountSignature?.toString(),
          }),
        });
        if (!recordRes.ok) {
          const json = await recordRes.json().catch(() => ({}));
          throw new Error(
            json.error ||
              "Deposit landed on-chain but server record failed — claim link not generated"
          );
        }
        const { claimLink } = (await recordRes.json()) as {
          claimLink: string;
        };

        reset({ stage: "settled", detail: null });
        return {
          activityId,
          burnerAddress,
          passphrase,
          claimLink,
          createUtxoSignature: result.createUtxoSignature.toString(),
          createProofAccountSignature: result.createProofAccountSignature.toString(),
          closeProofAccountSignature: result.closeProofAccountSignature?.toString(),
        };
      } catch (err: any) {
        // Walk error cause chain to surface Solana sim logs (same
        // pattern as useUmbraSend).
        const parts: string[] = [];
        let current = err;
        while (current) {
          if (current.message) parts.push(current.message);
          if (current.context?.logs) {
            parts.push(
              "Logs:\n" + (current.context.logs as string[]).join("\n")
            );
          }
          if (current.context && Object.keys(current.context).length > 0) {
            try {
              parts.push(
                "Context: " +
                  JSON.stringify(
                    current.context,
                    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
                    2
                  )
              );
            } catch {
              // ignore
            }
          }
          current = current.cause;
        }
        const msg = parts.join("\n\n---\n\n");
        // eslint-disable-next-line no-console
        console.error("[useUmbraSendClaim] error:", err);
        reset({ stage: "error", error: msg || err?.message || String(err) });
        throw err;
      }
    },
    [standardWallets, connectedWallets]
  );

  return {
    sendClaim,
    state,
    isLoading:
      state.stage !== "idle" &&
      state.stage !== "settled" &&
      state.stage !== "error",
  };
}
