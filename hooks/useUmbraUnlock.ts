"use client";

/**
 * Unlock = move user's Umbra-held USDC to their mainnet ATA.
 *
 * Flow:
 *   1. Scan claimable UTXOs and filter via the local tracker (drops
 *      already-claimed leaves the SDK scanner still returns).
 *   2. If unclaimed UTXOs exist, claim them via Umbra's relayer
 *      (gasless). Mark in tracker so future scans don't re-include them.
 *   3. Poll the encrypted balance until Arcium MPC has credited the
 *      claimed amount (~10–15s typical, capped at ~30s).
 *   4. Withdraw the requested amount from encrypted balance to the
 *      user's mainnet ATA via
 *      `getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction`.
 *
 * Polling avoids the "claim succeeds but encrypted balance not yet
 * credited" race that caused withdraw-with-amount > available errors.
 */

import { useCallback, useState } from "react";
import { useStandardWallets, useWallets } from "@privy-io/react-auth/solana";

import {
  getClaimableUtxoScannerFunction,
  getEncryptedBalanceQuerierFunction,
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction,
  getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction,
  getSelfClaimableUtxoToEncryptedBalanceClaimerFunction,
} from "@umbra-privacy/sdk";

import {
  getBrowserUmbraClient,
  getBrowserUmbraProverSuite,
  getBrowserUmbraRelayer,
} from "@/lib/client/umbraClientSDK";
import { createUmbraSignerFromPrivyWallet } from "@/lib/client/umbraPrivySigner";
import {
  fetchClaimedUtxoIds,
  filterUnclaimedUtxos,
  markUtxosClaimed,
} from "@/lib/client/umbraClaimedUtxoTracker";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Polling config for Arcium settlement after claim.
const SETTLE_POLL_INTERVAL_MS = 2_000;
const SETTLE_POLL_TIMEOUT_MS = 35_000;

export type UmbraUnlockStage =
  | "idle"
  | "scanning"
  | "claiming"
  | "settling"
  | "withdrawing"
  | "settled"
  | "error";

interface UmbraUnlockState {
  stage: UmbraUnlockStage;
  signature: string | null;
  error: string | null;
}

export interface UmbraUnlockParams {
  /**
   * Amount in base units to withdraw to mainnet ATA. If omitted, withdraws
   * everything available (claimed encrypted balance + any pending UTXOs
   * after claim).
   */
  amountBaseUnits?: bigint;
}

async function readEncryptedBalance(client: any): Promise<bigint> {
  const balanceMap = await getEncryptedBalanceQuerierFunction({ client })(
    [USDC_MINT as any]
  );
  const usdcResult = balanceMap.get(USDC_MINT as any);
  if (usdcResult && (usdcResult as any).state === "shared") {
    return (usdcResult as any).balance as bigint;
  }
  return BigInt(0);
}

async function pollUntilCredited(
  client: any,
  expectedMinimum: bigint
): Promise<bigint> {
  const start = Date.now();
  let last = await readEncryptedBalance(client);
  while (last < expectedMinimum && Date.now() - start < SETTLE_POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, SETTLE_POLL_INTERVAL_MS));
    last = await readEncryptedBalance(client);
  }
  return last;
}

export function useUmbraUnlock() {
  const { wallets: standardWallets } = useStandardWallets();
  const { wallets: connectedWallets } = useWallets();
  const [state, setState] = useState<UmbraUnlockState>({
    stage: "idle",
    signature: null,
    error: null,
  });

  const unlock = useCallback(async (
    params?: UmbraUnlockParams
  ): Promise<string> => {
    const requestedAmount = params?.amountBaseUnits;
    setState({ stage: "scanning", signature: null, error: null });

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

      // 1. Scan + filter claimable UTXOs via server tracker.
      const scanner = getClaimableUtxoScannerFunction({ client });
      const [scanResult, claimedIds] = await Promise.all([
        scanner(BigInt(0) as any, BigInt(0) as any),
        fetchClaimedUtxoIds(userAddress),
      ]);
      const receiverUtxos = filterUnclaimedUtxos(claimedIds, [
        ...((scanResult as any).received ?? []),
        ...((scanResult as any).publicReceived ?? []),
      ]);
      const selfUtxos = filterUnclaimedUtxos(claimedIds, [
        ...((scanResult as any).selfBurnable ?? []),
        ...((scanResult as any).publicSelfBurnable ?? []),
      ]);
      const hasPending = receiverUtxos.length > 0 || selfUtxos.length > 0;

      // Pre-claim encrypted balance (so we know what to wait for).
      let preBalance = await readEncryptedBalance(client);

      // 2. Claim if needed.
      if (hasPending) {
        setState({ stage: "claiming", signature: null, error: null });
        const relayer = await getBrowserUmbraRelayer();

        let pendingTotal = BigInt(0);
        for (const u of [...receiverUtxos, ...selfUtxos]) {
          const a = (u as any).amount;
          if (a !== undefined) pendingTotal += BigInt(a);
        }

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
          await markUtxosClaimed(userAddress, receiverUtxos);
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
          await markUtxosClaimed(userAddress, selfUtxos);
        }

        // 3. Wait for Arcium MPC to credit the encrypted balance.
        setState({ stage: "settling", signature: null, error: null });
        // We expect at least pre + (pendingTotal − some-fee). Polling
        // until balance > preBalance is the safe lower bound.
        await pollUntilCredited(client, preBalance + BigInt(1));
      }

      // 4. Read final available balance + withdraw.
      setState({ stage: "withdrawing", signature: null, error: null });
      const availableBaseUnits = await readEncryptedBalance(client);
      if (availableBaseUnits === BigInt(0)) {
        throw new Error(
          hasPending
            ? "Claim succeeded but encrypted balance is still 0 after waiting. Try again in a moment."
            : "Nothing to unlock — encrypted balance is 0."
        );
      }

      const amountBaseUnits =
        requestedAmount !== undefined ? requestedAmount : availableBaseUnits;
      if (amountBaseUnits <= BigInt(0)) {
        throw new Error("Amount must be greater than 0");
      }
      // Clamp to whatever actually settled (Arcium fees may shave a bit).
      const finalAmount =
        amountBaseUnits > availableBaseUnits
          ? availableBaseUnits
          : amountBaseUnits;

      const withdraw =
        getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction({ client });
      const sig = await withdraw(
        userAddress as any,
        USDC_MINT as any,
        finalAmount as any
      );
      const sigStr = sig.toString();

      setState({ stage: "settled", signature: sigStr, error: null });
      return sigStr;
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
      console.error("[useUmbraUnlock] error:", err);
      setState({
        stage: "error",
        signature: null,
        error: parts.join("\n\n---\n\n") || err?.message || String(err),
      });
      throw err;
    }
  }, [standardWallets, connectedWallets]);

  return {
    unlock,
    state,
    isLoading:
      state.stage === "scanning" ||
      state.stage === "claiming" ||
      state.stage === "settling" ||
      state.stage === "withdrawing",
  };
}
