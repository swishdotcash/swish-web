"use client";

import { useCallback, useState } from "react";
import { useWallets } from "@privy-io/react-auth/solana";

interface PrepareResponse {
  activityId: string;
  unsignedDepositTx: string;
  lastValidBlockHeight: number;
  estimatedFeeLamports: number;
  estimatedFeeSOL: number;
}

interface SubmitResponse {
  activityId: string;
  depositTx: string;
  withdrawTx: string;
}

interface SendParams {
  receiverAddress: string;
  amount: number;
  token?: string;
  message?: string;
  signature: string;
  senderPublicKey: string;
  providerId?: string;
}

interface UseSendTransactionResult {
  send: (params: SendParams) => Promise<SubmitResponse>;
  isLoading: boolean;
  error: string | null;
}

export function useSendTransaction(): UseSendTransactionResult {
  const { wallets } = useWallets();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const solanaWallet = wallets[0];

  const send = useCallback(
    async (params: SendParams): Promise<SubmitResponse> => {
      if (!solanaWallet) {
        throw new Error("No wallet connected");
      }

      if (!params.signature || !params.senderPublicKey) {
        throw new Error("No session signature. Please reconnect wallet.");
      }

      setIsLoading(true);
      setError(null);

      // Helper to cancel activity on failure
      const cancelActivity = async (activityId: string) => {
        try {
          await fetch("/api/activity/cancel", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Session-Signature": params.signature,
            },
            body: JSON.stringify({
              activityId,
              senderPublicKey: params.senderPublicKey,
            }),
          });
        } catch (e) {
          console.error("Failed to cancel activity:", e);
        }
      };

      let activityId: string | null = null;

      try {
        // Step 1: Call /api/send/prepare
        const prepareRes = await fetch("/api/send/prepare", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Session-Signature": params.signature,
          },
          body: JSON.stringify({
            senderPublicKey: params.senderPublicKey,
            receiverAddress: params.receiverAddress,
            amount: params.amount,
            token: params.token || "USDC",
            message: params.message,
            providerId: params.providerId,
          }),
        });

        if (!prepareRes.ok) {
          const errorData = await prepareRes.json();
          throw new Error(errorData.error || "Failed to prepare transaction");
        }

        const prepareResult: PrepareResponse = await prepareRes.json();
        activityId = prepareResult.activityId;

        // Step 2: Decode unsigned deposit transaction from base64 to bytes
        const depositTxBytes = Uint8Array.from(
          atob(prepareResult.unsignedDepositTx),
          (c) => c.charCodeAt(0)
        );

        // Step 3: Sign deposit transaction using wallet (user pays their own gas)
        let signedDepositResult;
        try {
          signedDepositResult = await solanaWallet.signTransaction(
            { transaction: depositTxBytes }
          );
        } catch (signError: any) {
          // User rejected or signing failed - cancel the activity
          if (activityId) {
            await cancelActivity(activityId);
          }
          throw new Error(signError.message || "Transaction signing rejected");
        }

        // Convert signed transaction to base64
        const signedDepositTx = btoa(
          String.fromCharCode.apply(null, Array.from(signedDepositResult.signedTransaction))
        );

        // Step 4: Call /api/send/submit
        const submitRes = await fetch("/api/send/submit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Session-Signature": params.signature,
          },
          body: JSON.stringify({
            signedDepositTx,
            activityId: prepareResult.activityId,
            senderPublicKey: params.senderPublicKey,
            receiverAddress: params.receiverAddress,
            amount: params.amount,
            token: params.token || "USDC",
            lastValidBlockHeight: prepareResult.lastValidBlockHeight,
            // Pass providerId so the submit route can validate the session
            // sig against the right protocol's message. PC + Send & Claim
            // flows stamp activity.provider_id at create and submit reads
            // from the row, but MB Send/Fulfill stamp at settle (PR #20
            // rule), so submit needs the body fallback.
            providerId: params.providerId,
          }),
        });

        if (!submitRes.ok) {
          const errorData = await submitRes.json();
          throw new Error(errorData.error || "Failed to submit transaction");
        }

        const submitResult: SubmitResponse = await submitRes.json();
        return submitResult;
      } catch (err: any) {
        const errorMessage = err.message || "Transaction failed";
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [solanaWallet]
  );

  return {
    send,
    isLoading,
    error,
  };
}
