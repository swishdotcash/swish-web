"use client";

/**
 * Claim incoming Umbra UTXOs into the user's encrypted balance.
 *
 * Direct Send to a user creates receiver-claimable UTXOs at their
 * address. These need an explicit claim step before they appear in the
 * encrypted balance and become withdrawable via Unlock.
 *
 * The claim is gasless via Umbra's relayer — user pays no SOL. After
 * the claim tx lands, Arcium MPC takes ~10-15s to credit the encrypted
 * balance.
 *
 * Kept separate from useUmbraUnlock so the two operations have distinct
 * UI states. Users can claim now, view balance go up, then unlock when
 * they're ready.
 */

import { useCallback, useState } from "react";
import { useStandardWallets, useWallets } from "@privy-io/react-auth/solana";

import {
  getClaimableUtxoScannerFunction,
  getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction,
  getSelfClaimableUtxoToEncryptedBalanceClaimerFunction,
} from "@umbra-privacy/sdk";

import {
  getBrowserUmbraClient,
  getBrowserUmbraProverSuite,
  getBrowserUmbraRelayer,
} from "@/lib/client/umbraClientSDK";
import { createUmbraSignerFromPrivyWallet } from "@/lib/client/umbraPrivySigner";

export type UmbraClaimStage =
  | "idle"
  | "scanning"
  | "claiming"
  | "settled"
  | "error";

interface UmbraClaimState {
  stage: UmbraClaimStage;
  claimedAmountBaseUnits: bigint;
  error: string | null;
}

export function useUmbraClaim() {
  const { wallets: standardWallets } = useStandardWallets();
  const { wallets: connectedWallets } = useWallets();
  const [state, setState] = useState<UmbraClaimState>({
    stage: "idle",
    claimedAmountBaseUnits: BigInt(0),
    error: null,
  });

  const claim = useCallback(async (): Promise<bigint> => {
    setState({
      stage: "scanning",
      claimedAmountBaseUnits: BigInt(0),
      error: null,
    });

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
      const suite = getBrowserUmbraProverSuite();

      const scanner = getClaimableUtxoScannerFunction({ client });
      const scanResult = await scanner(BigInt(0) as any, BigInt(0) as any);

      const receiverUtxos = [
        ...((scanResult as any).received ?? []),
        ...((scanResult as any).publicReceived ?? []),
      ];
      const selfUtxos = [
        ...((scanResult as any).selfBurnable ?? []),
        ...((scanResult as any).publicSelfBurnable ?? []),
      ];

      let totalClaimed = BigInt(0);
      for (const u of [...receiverUtxos, ...selfUtxos]) {
        const amt = (u as any).amount;
        if (amt !== undefined) totalClaimed += BigInt(amt);
      }

      if (receiverUtxos.length === 0 && selfUtxos.length === 0) {
        throw new Error("No pending UTXOs to claim.");
      }

      setState({
        stage: "claiming",
        claimedAmountBaseUnits: totalClaimed,
        error: null,
      });

      const relayer = await getBrowserUmbraRelayer();

      if (receiverUtxos.length > 0) {
        const claimReceiver =
          getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction(
            { client },
            {
              zkProver:
                suite.claimReceiverClaimableIntoEncryptedBalance,
              relayer,
              fetchBatchMerkleProof: (client as any).fetchBatchMerkleProof,
            } as any
          );
        await claimReceiver(receiverUtxos as any);
      }
      if (selfUtxos.length > 0) {
        const claimSelf =
          getSelfClaimableUtxoToEncryptedBalanceClaimerFunction(
            { client },
            {
              zkProver:
                suite.claimReceiverClaimableIntoEncryptedBalance as any,
              relayer,
              fetchBatchMerkleProof: (client as any).fetchBatchMerkleProof,
            } as any
          );
        await claimSelf(selfUtxos as any);
      }

      setState({
        stage: "settled",
        claimedAmountBaseUnits: totalClaimed,
        error: null,
      });
      return totalClaimed;
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
      console.error("[useUmbraClaim] error:", err);
      setState({
        stage: "error",
        claimedAmountBaseUnits: BigInt(0),
        error: parts.join("\n\n---\n\n") || err?.message || String(err),
      });
      throw err;
    }
  }, [standardWallets, connectedWallets]);

  return {
    claim,
    state,
    isLoading: state.stage === "scanning" || state.stage === "claiming",
  };
}
