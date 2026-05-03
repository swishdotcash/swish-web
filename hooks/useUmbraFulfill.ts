"use client";

/**
 * Client-side Umbra Request fulfill hook.
 *
 * Same SDK flow as useUmbraSend (1 consent + 2 deposit txs = 3 prompts),
 * but instead of creating a new activity row, marks an existing
 * `type='request'` row as settled with provider_id='umbra'.
 *
 * Uses /api/umbra/fulfill/record (atomic via claimActivity) so two
 * payers racing the same request can't both succeed.
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

export type UmbraFulfillStage =
  | "idle"
  | "constructing-client"
  | "checking-recipient"
  | "depositing"
  | "recording"
  | "settled"
  | "error";

export interface UmbraFulfillParams {
  activityId: string;
  receiverAddress: string;
  amountBaseUnits: bigint;
}

export interface UmbraFulfillResult {
  activityId: string;
  createProofAccountSignature: string;
  createUtxoSignature: string;
  closeProofAccountSignature?: string;
}

interface UmbraFulfillState {
  stage: UmbraFulfillStage;
  error: string | null;
  detail: string | null;
}

export function useUmbraFulfill() {
  const { wallets: standardWallets } = useStandardWallets();
  const { wallets: connectedWallets } = useWallets();
  const [state, setState] = useState<UmbraFulfillState>({
    stage: "idle",
    error: null,
    detail: null,
  });

  const fulfill = useCallback(
    async (params: UmbraFulfillParams): Promise<UmbraFulfillResult> => {
      const reset = (next: Partial<UmbraFulfillState>) =>
        setState((s) => ({ ...s, ...next }));

      reset({ stage: "constructing-client", error: null, detail: null });

      try {
        const userAddress = connectedWallets[0]?.address;
        if (!userAddress) throw new Error("No wallet connected");

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

        // Pre-flight: requester must be FULLY registered (PDA + x25519 +
        // commitment). Half-registered would pass `state === "exists"` but
        // the deposit would fail mid-flight.
        reset({ stage: "checking-recipient", detail: params.receiverAddress });
        const query = getUserAccountQuerierFunction({ client });
        const recipientState = await query(params.receiverAddress as any);
        const recipientData = (recipientState as any).data;
        const recipientFullyRegistered =
          recipientState.state === "exists" &&
          Boolean(recipientData?.x25519PublicKey && recipientData?.userCommitment);
        if (!recipientFullyRegistered) {
          throw new Error(
            "Requester is not fully registered on Umbra. Pay via Privacy Cash instead, or ask the requester to finish enabling Umbra in their profile."
          );
        }

        reset({
          stage: "depositing",
          detail: "Sign each prompt to fulfill privately (~3 prompts)",
        });

        const suite = getBrowserUmbraProverSuite();
        const deposit = getPublicBalanceToReceiverClaimableUtxoCreatorFunction(
          { client },
          {
            zkProver:
              suite.utxoReceiverClaimable as unknown as ZkProverForReceiverClaimableUtxoFromPublicBalance,
          }
        );

        const result = await deposit({
          amount: params.amountBaseUnits as any,
          destinationAddress: params.receiverAddress as any,
          mint: USDC_MINT as any,
        });

        reset({ stage: "recording", detail: null });
        const recordRes = await fetch("/api/umbra/fulfill/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            activityId: params.activityId,
            payerAddress: userAddress,
            createUtxoSignature: result.createUtxoSignature.toString(),
            createProofAccountSignature: result.createProofAccountSignature.toString(),
            closeProofAccountSignature: result.closeProofAccountSignature?.toString(),
          }),
        });
        if (!recordRes.ok) {
          const json = await recordRes.json().catch(() => ({}));
          // Deposit already settled on-chain. Surface the error but don't
          // throw — the requester got paid; only the activity row didn't
          // update. Show a distinct warning so the user knows.
          console.warn(
            "Fulfill recording failed (deposit already settled):",
            json
          );
        }

        reset({ stage: "settled", detail: null });
        return {
          activityId: params.activityId,
          createProofAccountSignature: result.createProofAccountSignature.toString(),
          createUtxoSignature: result.createUtxoSignature.toString(),
          closeProofAccountSignature: result.closeProofAccountSignature?.toString(),
        };
      } catch (err: any) {
        const parts: string[] = [];
        let current = err;
        while (current) {
          if (current.message) parts.push(current.message);
          if (current.context?.logs) {
            parts.push("Logs:\n" + (current.context.logs as string[]).join("\n"));
          }
          current = current.cause;
        }
        const msg = parts.join("\n\n---\n\n");
        // eslint-disable-next-line no-console
        console.error("[useUmbraFulfill] error:", err);
        reset({ stage: "error", error: msg || err?.message || String(err) });
        throw err;
      }
    },
    [standardWallets, connectedWallets]
  );

  return {
    fulfill,
    state,
    isLoading:
      state.stage !== "idle" &&
      state.stage !== "settled" &&
      state.stage !== "error",
  };
}
