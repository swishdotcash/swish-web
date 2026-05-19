"use client";

import { useEffect, useState, use } from "react";
import { motion } from "motion/react";
import Image from "next/image";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import { formatNumber } from "@/utils";
import { Spinner, ProtocolBadge, WalletStatus } from "@/components";
import { useSessionSignature } from "@/hooks/useSessionSignature";
import { useProtocolFee } from "@/hooks/useProtocolFee";
import { useAutoRoute } from "@/hooks/useAutoRoute";
import { useUmbraFulfill } from "@/hooks/useUmbraFulfill";
import { useUmbraStatus } from "@/hooks/useUmbraStatus";
import type { ProviderId } from "@/lib/providers/types";
import {
  areAllProvidersDisabled,
  isProviderDisabled,
} from "@/lib/providers/maintenance";

const FULFILL_PROVIDER_POOL: ProviderId[] = [
  "umbra",
  "magicblock-per",
  "privacy-cash",
];

interface RequestData {
  id: string;
  amount: number;
  token: string;
  status: string;
  message: string | null;
  createdAt: string;
  receiverAddress?: string;
}

type PageState =
  | "loading"
  | "ready"
  | "processing"
  | "success"
  | "error"
  | "not_found"
  | "already_paid"
  | "cancelled"
  | "cancelling";

type ProviderChoice = "auto" | "privacy-cash" | "magicblock-per" | "umbra";

export default function RequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { login, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { walletAddress, getSignature } = useSessionSignature();
  // Mint MB session sig — when payer picks MB, server expects MB-signed sig.
  const { getSignature: getMbSessionSignature } =
    useSessionSignature("magicblock-per");
  // Request cancel is protocol-agnostic — uses the Swish request session sig.
  const { getSignature: getRequestSessionSignature } =
    useSessionSignature("request");
  const [requestData, setRequestData] = useState<RequestData | null>(null);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderChoice>("auto");
  const { fulfill: umbraFulfill, state: umbraFulfillState } = useUmbraFulfill();
  const { status: umbraStatus } = useUmbraStatus();
  const [requesterUmbraStatus, setRequesterUmbraStatus] = useState<
    "idle" | "checking" | "registered" | "unregistered" | "error"
  >("idle");

  // Resolve Auto for the payer once we know both addresses (payer's
  // wallet + requester's address from the row). The hook gracefully
  // sits idle when inputs aren't ready.
  const noAutoTarget = areAllProvidersDisabled(FULFILL_PROVIDER_POOL);
  const { resolved: autoResolved, unavailable: autoUnavailable } = useAutoRoute({
    enabled: provider === "auto" && !!requestData?.receiverAddress,
    flow: "fulfill",
    senderAddress: walletAddress,
    receiverAddress: requestData?.receiverAddress ?? null,
  });

  // Effective provider for fee + dispatch. When picker is Auto and we've
  // resolved, use the resolved one; otherwise fall back to "auto" (fee
  // hook treats as PC worst-case).
  const effectiveProvider: ProviderId | "auto" =
    provider === "auto" ? (autoResolved ?? "auto") : provider;

  // Per-protocol fee, driven by the effective provider so Auto reflects
  // its resolved route's fee instead of PC worst-case.
  const { feeUSDC: partnerFee, breakdown: feeBreakdown } = useProtocolFee(
    effectiveProvider,
    requestData?.amount ?? 0,
    "fulfill"
  );

  const solanaWallet = wallets[0];

  useEffect(() => {
    async function fetchRequestData() {
      try {
        const res = await fetch(`/api/request/${id}`);

        if (res.status === 404) {
          setPageState("not_found");
          return;
        }

        if (!res.ok) {
          throw new Error("Failed to fetch request data");
        }

        const data: RequestData = await res.json();
        setRequestData(data);

        if (data.status === "settled") {
          setPageState("already_paid");
        } else if (data.status === "cancelled") {
          setPageState("cancelled");
        } else {
          setPageState("ready");
        }
      } catch (error) {
        console.error("Error fetching request:", error);
        setPageState("error");
      }
    }

    fetchRequestData();
  }, [id]);

  // Pre-check requester's Umbra registration so the picker can disable
  // Umbra upfront instead of letting the fulfill fail at runtime. We don't
  // surface the result in any visible copy — only used to gate the picker.
  useEffect(() => {
    const addr = requestData?.receiverAddress;
    if (!addr) {
      setRequesterUmbraStatus("idle");
      return;
    }
    let cancelled = false;
    setRequesterUmbraStatus("checking");
    (async () => {
      try {
        const res = await fetch(
          `/api/umbra/status?address=${encodeURIComponent(addr)}`
        );
        if (cancelled) return;
        if (!res.ok) {
          setRequesterUmbraStatus("error");
          return;
        }
        const json = (await res.json()) as { registered: boolean };
        setRequesterUmbraStatus(
          json.registered ? "registered" : "unregistered"
        );
      } catch {
        if (!cancelled) setRequesterUmbraStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestData?.receiverAddress]);

  const handlePay = async () => {
    if (!authenticated) {
      login();
      return;
    }

    if (!requestData?.receiverAddress) {
      return;
    }

    setPageState("processing");
    setErrorMessage(null);

    try {
      // Resolve Auto if needed. For wallet-mode payers (always the case
      // on /r since requester is always a wallet address), useAutoRoute
      // has already resolved by the time the user clicks Pay — so this
      // only fires the preview fetch as a defensive fallback.
      let dispatchProvider: ProviderId | "auto" = effectiveProvider;
      if (provider === "auto" && dispatchProvider === "auto") {
        const previewRes = await fetch(
          `/api/router/preview?flow=fulfill&sender=${encodeURIComponent(
            walletAddress || ""
          )}&receiver=${encodeURIComponent(requestData.receiverAddress)}`
        );
        const previewJson = (await previewRes.json()) as {
          providerId: ProviderId;
        };
        dispatchProvider = previewJson.providerId;
      }

      if (dispatchProvider === "umbra") {
        // Client-side Umbra fulfill: 3 wallet prompts, requester must be
        // registered. Fail-fast inside the hook if not.
        const baseUnits = BigInt(Math.round(requestData.amount * 1_000_000));
        await umbraFulfill({
          activityId: id,
          receiverAddress: requestData.receiverAddress,
          amountBaseUnits: baseUnits,
        });
        setPageState("success");
        return;
      }

      // Inner helper — runs the full prepare→sign→submit cycle for a
      // given non-Umbra provider. Throws on any step's failure.
      const runMbOrPc = async (target: ProviderId) => {
        const session =
          target === "magicblock-per"
            ? await getMbSessionSignature()
            : await getSignature();
        if (!session) {
          throw new Error("Signature required to continue");
        }

        const prepareRes = await fetch("/api/request/fulfill/prepare", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Session-Signature": session.signature,
          },
          body: JSON.stringify({
            activityId: id,
            payerPublicKey: session.address,
            providerId: target,
          }),
        });

        if (!prepareRes.ok) {
          const errorData = await prepareRes.json();
          throw new Error(errorData.error || "Failed to prepare transaction");
        }

        const prepareResult = await prepareRes.json();

        const depositTxBytes = Uint8Array.from(
          atob(prepareResult.unsignedDepositTx),
          (c) => c.charCodeAt(0),
        );

        const signedDepositResult = await solanaWallet.signTransaction({
          transaction: depositTxBytes,
        });

        const signedDepositTx = btoa(
          String.fromCharCode.apply(
            null,
            Array.from(signedDepositResult.signedTransaction),
          ),
        );

        const submitRes = await fetch("/api/request/fulfill/submit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Session-Signature": session.signature,
          },
          body: JSON.stringify({
            signedDepositTx,
            activityId: prepareResult.activityId,
            payerPublicKey: session.address,
            lastValidBlockHeight: prepareResult.lastValidBlockHeight,
            providerId: target,
          }),
        });

        if (!submitRes.ok) {
          const errorData = await submitRes.json();
          throw new Error(errorData.error || "Failed to submit transaction");
        }
      };

      try {
        await runMbOrPc(dispatchProvider as ProviderId);
      } catch (mbErr: any) {
        // Auto-fallback: MB failed under Auto → retry once with PC.
        if (provider === "auto" && dispatchProvider === "magicblock-per") {
          console.warn("MB failed under Auto, falling back to PC:", mbErr);
          dispatchProvider = "privacy-cash";
          await runMbOrPc("privacy-cash");
        } else {
          throw mbErr;
        }
      }

      setPageState("success");
    } catch (error: any) {
      console.error("Pay request failed:", error);
      setErrorMessage(error.message || "Something went wrong");
      setPageState("error");
    }
  };

  const formatAddress = (addr: string) => {
    if (addr.length <= 10) return addr;
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  // Check if current user is the requestor (owner of this request)
  const isRequestor =
    authenticated &&
    walletAddress &&
    requestData?.receiverAddress &&
    walletAddress.toLowerCase() === requestData.receiverAddress.toLowerCase();

  const handleCancel = async () => {
    if (!authenticated) {
      login();
      return;
    }

    const session = await getRequestSessionSignature();
    if (!session) {
      setErrorMessage("Signature required to continue");
      setPageState("error");
      return;
    }

    setPageState("cancelling");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/request/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Signature": session.signature,
        },
        body: JSON.stringify({
          activityId: id,
          requesterAddress: session.address,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to cancel request");
      }

      setPageState("cancelled");
    } catch (error: any) {
      console.error("Cancel request failed:", error);
      setErrorMessage(error.message || "Something went wrong");
      setPageState("error");
    }
  };

  if (pageState === "loading") {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <Spinner size={48} color="#121212" />
        <p className="mt-4 text-[#121212]/70">Loading request...</p>
      </main>
    );
  }

  if (pageState === "not_found") {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <span className="text-red-500 text-2xl">!</span>
        </div>
        <p className="text-[#121212] font-medium">Request not found</p>
        <p className="text-[#121212]/60 text-sm mt-2">
          This link may be invalid or expired.
        </p>
      </main>
    );
  }

  if (pageState === "error") {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <span className="text-red-500 text-2xl">!</span>
        </div>
        <p className="text-[#121212] font-medium">Something went wrong</p>
        <p className="text-[#121212]/60 text-sm mt-2">
          {errorMessage || "Please try again later."}
        </p>
        <motion.button
          onClick={() => setPageState("ready")}
          whileTap={{ scale: 0.98 }}
          className="mt-4 px-6 h-10 bg-[#121212] rounded-full text-[#fafafa] font-semibold"
        >
          Try Again
        </motion.button>
      </main>
    );
  }

  if (pageState === "already_paid") {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <div className="w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center mb-4">
          <span className="text-yellow-600 text-2xl">!</span>
        </div>
        <p className="text-[#121212] font-medium">Already paid</p>
        <p className="text-[#121212]/60 text-sm mt-2">
          This request has already been fulfilled.
        </p>
      </main>
    );
  }

  if (pageState === "cancelled") {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <span className="text-[#CB0000] text-2xl">!</span>
        </div>
        <p className="text-[#121212] font-medium">Request Cancelled</p>
        <p className="text-[#121212]/60 text-sm mt-2">
          This payment request has been cancelled.
        </p>
      </main>
    );
  }

  if (pageState === "processing" || pageState === "cancelling") {
    const processingLabel =
      pageState === "cancelling"
        ? "Cancelling request..."
        : provider === "umbra"
          ? umbraFulfillState.stage === "checking-recipient"
            ? "Checking requester on Umbra..."
            : umbraFulfillState.stage === "depositing"
              ? "Sign each prompt to fulfill privately"
              : umbraFulfillState.stage === "recording"
                ? "Finalizing..."
                : "Preparing private payment..."
          : "Processing payment...";
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <Spinner size={48} color="#121212" />
        <p className="mt-4 text-[#121212]/70">{processingLabel}</p>
        {pageState === "processing" &&
          provider === "umbra" &&
          umbraFulfillState.stage === "depositing" && (
            <p className="mt-1 text-[#121212]/50 text-xs">
              ~3 wallet prompts total
            </p>
          )}
      </main>
    );
  }

  if (!requestData) return null;

  const requestorReceives = requestData.amount - partnerFee;

  return (
    <main className="flex flex-col items-center p-4 w-full">
      {/* Amount Display */}
      <div className="flex flex-col items-center mb-6 w-full max-w-full">
        <div className="w-full max-w-[320px] overflow-x-auto scrollbar-hide">
          <p className="text-6xl font-light text-[#121212] text-center">
            ${formatNumber(requestData.amount)}
          </p>
        </div>
        {requestData.message && (
          <p className="mt-2 text-[#121212]/50 text-sm">
            {requestData.message}
          </p>
        )}
      </div>

      <div className="w-full flex justify-center mb-6">
        <WalletStatus />
      </div>

      {/* Details */}
      <div className="w-full max-w-[320px] space-y-2 mb-8">
        {provider === "auto" && !isRequestor && (
          <div className="flex justify-between">
            <span className="text-[#121212]">Routed via</span>
            {autoResolved ? (
              <ProtocolBadge providerId={autoResolved} />
            ) : (
              <span className="text-[#121212]">…</span>
            )}
          </div>
        )}
        <div className="flex justify-between">
          <div>
            <span className="text-[#121212]">Partner fees</span>
            <span className="text-[#121212]/40 text-xs ml-1">
              ({feeBreakdown})
            </span>
          </div>
          <span className="text-[#121212]">
            ~{formatNumber(partnerFee)} USDC
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#121212]">{isRequestor ? "You receive" : "They receive"}</span>
          <span className="text-[#121212]">
            ~{formatNumber(requestorReceives)} USDC
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#121212] font-semibold">Total</span>
          <span className="text-[#121212] font-semibold">
            {formatNumber(requestData.amount)} USDC
          </span>
        </div>
      </div>

      {/* Privacy provider picker (only for payers, when ready) */}
      {pageState === "ready" && authenticated && !isRequestor && (
        <div className="w-full max-w-[320px] mb-4">
          <label className="text-sm text-[#121212]/50 mb-1 block">
            Privacy protocol
          </label>
          <div className="space-y-1.5">
            <button
              onClick={() => {
                if (noAutoTarget) return;
                setProvider("auto");
              }}
              disabled={noAutoTarget}
              title={
                noAutoTarget
                  ? "All privacy protocols are temporarily unavailable"
                  : undefined
              }
              className={`w-fit min-w-[72px] h-9 px-4 rounded-full text-xs font-medium transition-all flex items-center justify-center ${
                provider === "auto"
                  ? "bg-[#121212] text-[#fafafa]"
                  : noAutoTarget
                    ? "bg-[#121212]/5 text-[#121212]/30 cursor-not-allowed opacity-40"
                    : "bg-[#121212]/5 text-[#121212]/70 hover:bg-[#121212]/10"
              }`}
            >
              Auto
            </button>
            <div className="flex gap-1.5">
              {(
                [
                  "umbra",
                  "magicblock-per",
                  "privacy-cash",
                ] as ProviderId[]
              ).map((p) => {
                const umbraIneligible =
                  p === "umbra" &&
                  (umbraStatus !== "registered" ||
                    requesterUmbraStatus === "unregistered");
                const maintenanceDisabled = isProviderDisabled(p);
                const isDisabled = umbraIneligible || maintenanceDisabled;
                return (
                  <button
                    key={p}
                    onClick={() => {
                      if (isDisabled) return;
                      setProvider(p);
                    }}
                    disabled={isDisabled}
                    title={
                      maintenanceDisabled
                        ? "Temporarily unavailable (maintenance)"
                        : undefined
                    }
                    className={`flex-1 min-w-[72px] h-9 rounded-full text-xs font-medium transition-all flex items-center justify-center ${
                      provider === p
                        ? "bg-[#121212] text-[#fafafa]"
                        : isDisabled
                          ? "bg-[#121212]/5 text-[#121212]/30 cursor-not-allowed opacity-40"
                          : "bg-[#121212]/5 text-[#121212]/70 hover:bg-[#121212]/10"
                    }`}
                  >
                    <ProtocolBadge providerId={p} iconSize={14} />
                  </button>
                );
              })}
            </div>
          </div>
          {authenticated && umbraStatus === "unregistered" && (
            <p className="text-xs text-[#121212]/50 mt-2">
              Enable Umbra in your{" "}
              <a
                href="/p"
                className="underline underline-offset-2 decoration-dashed hover:text-[#121212]"
              >
                profile
              </a>{" "}
              to fulfill via Umbra.
            </p>
          )}
        </div>
      )}

      {/* Pay Button (for payers) or Cancel Button (for requestor) */}
      {pageState === "ready" && !isRequestor && (
        <motion.button
          onClick={handlePay}
          disabled={provider === "auto" && (noAutoTarget || autoUnavailable)}
          whileTap={{ scale: 0.98 }}
          className="w-full max-w-[320px] h-12 bg-[#121212] rounded-full flex items-center justify-center text-[#fafafa] font-semibold disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
        >
          Fulfill
        </motion.button>
      )}

      {/* Cancel Button (for requestor only) */}
      {pageState === "ready" && isRequestor && (
        <motion.button
          onClick={handleCancel}
          whileTap={{ scale: 0.98 }}
          className="w-full max-w-[320px] h-12 bg-[#fafafa] border border-[#CB0000] rounded-full flex items-center justify-center text-[#CB0000] font-semibold shadow-[0_2px_8px_rgba(203,0,0,0.1)]"
        >
          Cancel Request
        </motion.button>
      )}

      {/* Success State */}
      {pageState === "success" && (
        <motion.button
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-full max-w-[320px] h-12 bg-[#fafafa] border border-[#121212]/70 rounded-full flex items-center justify-center shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
        >
          <Image
            src="/assets/success-alt.svg"
            alt="Success"
            width={24}
            height={24}
          />
        </motion.button>
      )}
    </main>
  );
}
