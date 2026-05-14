"use client";

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import { PublicKey } from "@solana/web3.js";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { QRScanner } from "./QRScanner";
import { ProtocolBadge } from "./ProtocolBadge";
import { formatNumber } from "@/utils";
import { useSendTransaction } from "@/hooks/useSendTransaction";
import { useUmbraSend } from "@/hooks/useUmbraSend";
import { useUmbraStatus } from "@/hooks/useUmbraStatus";
import { useProtocolFee } from "@/hooks/useProtocolFee";
import { useAutoRoute } from "@/hooks/useAutoRoute";
import {
  useSessionSignature,
  type GetSessionSignature,
} from "@/hooks/useSessionSignature";
import type { ProviderId } from "@/lib/providers/types";

interface SendModalProps {
  isOpen: boolean;
  onClose: () => void;
  amount: string;
  /** Sender's USDC balance. null while loading. */
  balance: number | null;
  /** Set the amount in the parent — used by the "send max" affordance. */
  onUseMaxAmount: (amount: string) => void;
  onSendViaClaim: () => void;
  getSignature: GetSessionSignature;
}

type ModalState = "input" | "loading" | "success" | "error";
type RecipientType = "wallet" | "x";
type ProviderChoice = "auto" | "privacy-cash" | "magicblock-per" | "umbra";

export function SendModal({
  isOpen,
  onClose,
  amount,
  balance,
  onUseMaxAmount,
  onSendViaClaim,
  getSignature,
}: SendModalProps) {
  const [walletAddress, setWalletAddress] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [recipientType, setRecipientType] = useState<RecipientType>("wallet");
  const [provider, setProvider] = useState<ProviderChoice>("auto");
  const [recipientUmbraStatus, setRecipientUmbraStatus] = useState<
    "idle" | "checking" | "registered" | "unregistered" | "error"
  >("idle");
  const [resolvedXAddress, setResolvedXAddress] = useState<string | null>(null);
  const [state, setState] = useState<ModalState>("input");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [isResolvingX, setIsResolvingX] = useState(false);
  const { send } = useSendTransaction();
  const { send: umbraSend, state: umbraSendState } = useUmbraSend();
  const { status: umbraStatus } = useUmbraStatus();
  // Mint MB session sig — when user picks MB (or Auto resolves to MB),
  // server expects MB-signed sig (per `getSessionMessageForProvider`).
  // walletAddress here is the SENDER (current user) — same regardless of
  // session-context arg.
  const {
    getSignature: getMbSessionSignature,
    walletAddress: senderAddress,
  } = useSessionSignature("magicblock-per");

  const numAmount = parseFloat(amount) || 0;

  const isValidAddress = useMemo(() => {
    if (!walletAddress) return false;
    try {
      new PublicKey(walletAddress);
      return true;
    } catch {
      return false;
    }
  }, [walletAddress]);

  const isValidXHandle = useMemo(() => {
    if (!xHandle) return false;
    // Basic X handle validation: alphanumeric and underscores, 1-15 chars
    return /^[a-zA-Z0-9_]{1,15}$/.test(xHandle);
  }, [xHandle]);

  // Resolve Auto pre-proceed for both wallet and X modes. For X mode we
  // wait until the check-x debounce has produced a final status before
  // firing — `resolvedXAddress` is null until the handle is found, and
  // for Case 3 (brand-new X user) it stays null forever. The server's
  // preview handles null receiver gracefully (falls through to MB/PC).
  const xResolveSettled =
    recipientUmbraStatus !== "idle" && recipientUmbraStatus !== "checking";
  const { resolved: autoResolved } = useAutoRoute({
    enabled:
      provider === "auto" &&
      ((recipientType === "wallet" && isValidAddress) ||
        (recipientType === "x" && isValidXHandle && xResolveSettled)),
    flow: "send",
    senderAddress: senderAddress,
    receiverAddress:
      recipientType === "wallet" && isValidAddress
        ? walletAddress
        : recipientType === "x"
          ? resolvedXAddress
          : null,
  });

  // Effective provider for dispatch + fee display. When picker is Auto
  // and we've resolved, use the resolved one; otherwise fall back to
  // "auto" (which the fee hook treats as PC worst-case).
  const effectiveProvider: ProviderId | "auto" =
    provider === "auto" ? (autoResolved ?? "auto") : provider;

  const {
    feeUSDC: partnerFee,
    breakdown: feeBreakdown,
    chargedOnTop,
  } = useProtocolFee(effectiveProvider, numAmount, "send");

  // What the sender's wallet is actually debited vs. what the recipient
  // ends up with — differs by whether the protocol charges on top (MB) or
  // takes the fee out of the amount (PC, Umbra).
  const senderCost = chargedOnTop ? numAmount + partnerFee : numAmount;
  const theyReceive = chargedOnTop ? numAmount : numAmount - partnerFee;

  // Fee-aware balance check. For on-top protocols the sender needs
  // amount + fee, so entering exactly their balance would fail on-chain.
  const exceedsBalanceWithFee =
    balance !== null && numAmount > 0 && senderCost > balance + 1e-6;

  // Largest amount the sender can actually afford given the on-top fee.
  // feeRate is derived from the current estimate so it stays correct if
  // the rate ever changes. Truncated (never rounded up) to 6-decimal USDC.
  const feeRate = numAmount > 0 ? partnerFee / numAmount : 0;
  const maxSendable =
    balance === null
      ? null
      : chargedOnTop
        ? Math.floor((balance / (1 + feeRate)) * 1e6) / 1e6
        : balance;

  const canProceed =
    (recipientType === "wallet" ? isValidAddress : isValidXHandle) &&
    !exceedsBalanceWithFee;

  // Debounced recipient registration check. Wallet mode hits
  // /api/umbra/status (on-chain only). X mode hits /api/user/check-x
  // (DB lookup + on-chain) which also resolves the wallet address —
  // stored in resolvedXAddress for useAutoRoute.
  useEffect(() => {
    const validWallet = recipientType === "wallet" && isValidAddress;
    const validX = recipientType === "x" && isValidXHandle;
    if (!validWallet && !validX) {
      setRecipientUmbraStatus("idle");
      setResolvedXAddress(null);
      return;
    }
    let cancelled = false;
    setRecipientUmbraStatus("checking");
    const t = setTimeout(async () => {
      try {
        if (validWallet) {
          const res = await fetch(
            `/api/umbra/status?address=${encodeURIComponent(walletAddress)}`
          );
          if (cancelled) return;
          if (!res.ok) {
            setRecipientUmbraStatus("error");
            return;
          }
          const json = (await res.json()) as { registered: boolean };
          setRecipientUmbraStatus(
            json.registered ? "registered" : "unregistered"
          );
        } else {
          const res = await fetch(
            `/api/user/check-x?handle=${encodeURIComponent(xHandle)}`
          );
          if (cancelled) return;
          if (!res.ok) {
            setRecipientUmbraStatus("error");
            return;
          }
          const json = (await res.json()) as {
            exists: boolean;
            walletAddress: string | null;
            umbraRegistered: boolean;
          };
          setResolvedXAddress(json.walletAddress);
          setRecipientUmbraStatus(
            json.umbraRegistered ? "registered" : "unregistered"
          );
        }
      } catch {
        if (!cancelled) setRecipientUmbraStatus("error");
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [walletAddress, xHandle, recipientType, isValidAddress, isValidXHandle]);

  // If the user is currently on Umbra and the recipient turns out to be
  // unregistered, we DO NOT silently switch them — that would route the
  // send through PC and surprise the user with a PC sig prompt. Instead
  // we block proceed (see canProceedFinal below) and show a clear hint.
  // The user must manually pick a different protocol. Applies in both
  // wallet and X modes (X mode resolves recipientUmbraStatus via check-x).
  const umbraBlockedByRecipient =
    provider === "umbra" && recipientUmbraStatus === "unregistered";

  const resolveXHandle = async (): Promise<string | null> => {
    setIsResolvingX(true);
    try {
      const res = await fetch("/api/user/resolve-x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ twitterHandle: xHandle }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to resolve X handle");
      }

      const { walletAddress: resolved } = await res.json();
      return resolved;
    } catch (err: any) {
      throw err;
    } finally {
      setIsResolvingX(false);
    }
  };

  const handleProceed = async () => {
    if (!canProceed) return;

    setState("loading");
    setErrorMessage(null);

    try {
      let receiverAddress = walletAddress;

      // If X mode, resolve handle to wallet address first
      if (recipientType === "x") {
        const resolved = await resolveXHandle();
        if (!resolved) {
          throw new Error("Could not resolve X handle to wallet address");
        }
        receiverAddress = resolved;
        setWalletAddress(resolved);
      }

      // For Auto + X-handle, the recipient just resolved — call the
      // router preview now that we know the receiver. For Auto + wallet
      // mode, autoResolved is already populated by useAutoRoute.
      let dispatchProvider: ProviderId | "auto" = effectiveProvider;
      if (provider === "auto" && dispatchProvider === "auto") {
        const previewRes = await fetch(
          `/api/router/preview?flow=send&sender=${encodeURIComponent(
            senderAddress || ""
          )}&receiver=${encodeURIComponent(receiverAddress)}`
        );
        const previewJson = (await previewRes.json()) as {
          providerId: ProviderId;
        };
        dispatchProvider = previewJson.providerId;
      }

      // Umbra direct Send runs the SDK client-side (3 prompts: consent + 2 deposit txs).
      // PC and MB go through the server-prepare/submit flow with their
      // own session messages.
      if (dispatchProvider === "umbra") {
        const baseUnits = BigInt(Math.round(numAmount * 1_000_000));
        await umbraSend({
          receiverAddress,
          amountBaseUnits: baseUnits,
        });
      } else {
        // Pick the right session-sig hook for the resolved protocol.
        // PC uses the parent's PC sig (the default).
        const session =
          dispatchProvider === "magicblock-per"
            ? await getMbSessionSignature()
            : await getSignature();
        if (!session) {
          throw new Error("Signature required to continue");
        }
        try {
          await send({
            receiverAddress,
            amount: numAmount,
            token: "USDC",
            signature: session.signature,
            senderPublicKey: session.address,
            // Pass the *resolved* providerId so the server validates
            // against the matching session message and dispatches to the
            // right provider — even when the user picked Auto.
            providerId: dispatchProvider,
          });
        } catch (mbErr: any) {
          // Auto-fallback: when picker is Auto and MB dispatch fails
          // (catches partial outages /health doesn't see), retry once
          // with PC. Costs a PC session-sig prompt if not cached.
          if (provider === "auto" && dispatchProvider === "magicblock-per") {
            console.warn("MB failed under Auto, falling back to PC:", mbErr);
            const pcSession = await getSignature();
            if (!pcSession) throw mbErr;
            dispatchProvider = "privacy-cash";
            await send({
              receiverAddress,
              amount: numAmount,
              token: "USDC",
              signature: pcSession.signature,
              senderPublicKey: pcSession.address,
              providerId: "privacy-cash",
            });
          } else {
            throw mbErr;
          }
        }
      }
      setState("success");
    } catch (error: any) {
      console.error("Send failed:", error);
      setErrorMessage(error.message || "Transaction failed");
      setState("error");
    }
  };

  const handleClose = () => {
    setState("input");
    setWalletAddress("");
    setXHandle("");
    setRecipientType("wallet");
    setProvider("auto");
    setErrorMessage(null);
    setIsResolvingX(false);
    setRecipientUmbraStatus("idle");
    onClose();
  };

  const handleRetry = () => {
    setState("input");
    setErrorMessage(null);
  };

  const handleQRScan = (address: string) => {
    setWalletAddress(address);
    setShowQRScanner(false);
  };

  const formatAddress = (address: string) => {
    if (address.length <= 10) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const displayRecipient =
    recipientType === "x" && xHandle ? `@${xHandle}` : formatAddress(walletAddress);

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose}>
        {/* Header */}
        <div className="flex items-center gap-2 mb-6">
          <Image
            src="/assets/send.svg"
            alt="Send"
            width={24}
            height={24}
            className="invert"
          />
          <h2 className="text-2xl font-semibold text-[#121212]">Send</h2>
        </div>

        <AnimatePresence mode="wait">
          {state === "input" && (
            <motion.div
              key="input"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Recipient Type Toggle */}
              <div className="flex mb-4 bg-[#121212]/5 rounded-full p-1">
                <button
                  onClick={() => setRecipientType("wallet")}
                  className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-full text-sm font-medium transition-all ${
                    recipientType === "wallet"
                      ? "bg-[#121212] text-[#fafafa]"
                      : "text-[#121212]/50"
                  }`}
                >
                  <Image
                    src="/assets/sol-icon.svg"
                    alt=""
                    width={14}
                    height={14}

                  />
                  Wallet
                </button>
                <button
                  onClick={() => setRecipientType("x")}
                  className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-full text-sm font-medium transition-all ${
                    recipientType === "x"
                      ? "bg-[#121212] text-[#fafafa]"
                      : "text-[#121212]/50"
                  }`}
                >
                  <Image
                    src="/assets/x-icon.svg"
                    alt=""
                    width={14}
                    height={14}
                    className={recipientType === "x" ? "invert" : ""}
                  />
                  X Profile
                </button>
              </div>

              {/* Recipient Input */}
              <div className="mb-6">
                {recipientType === "wallet" ? (
                  <>
                    <label className="text-sm text-[#121212]/50 mb-1 block">
                      Enter wallet address
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={walletAddress}
                        onChange={(e) => setWalletAddress(e.target.value)}
                        placeholder=""
                        className="flex-1 h-12 px-4 rounded-full border border-[#121212]/10 bg-transparent text-[#121212] outline-none focus:border-[#121212]/30 transition-colors"
                      />
                      <button
                        onClick={() => setShowQRScanner(true)}
                        className="w-12 h-12 rounded-full border border-[#121212]/10 flex items-center justify-center hover:bg-[#121212]/5 transition-colors shrink-0"
                      >
                        <Image
                          src="/assets/scan-icon.svg"
                          alt="Scan QR"
                          width={20}
                          height={20}
                        />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="text-sm text-[#121212]/50 mb-1 block">
                      Enter X profile (without @)
                    </label>
                    <input
                      type="text"
                      value={xHandle}
                      onChange={(e) =>
                        setXHandle(e.target.value.replace(/^@/, ""))
                      }
                      placeholder=""
                      className="w-full h-12 px-4 rounded-full border border-[#121212]/10 bg-transparent text-[#121212] outline-none focus:border-[#121212]/30 transition-colors"
                    />
                  </>
                )}
              </div>

              {/* Privacy provider picker (compact) */}
              <div className="mb-6">
                <label className="text-sm text-[#121212]/50 mb-1 block">
                  Privacy protocol
                </label>
                <div className="space-y-1.5">
                  <button
                    onClick={() => setProvider("auto")}
                    className={`w-fit min-w-[72px] h-9 px-4 rounded-full text-xs font-medium transition-all flex items-center justify-center ${
                      provider === "auto"
                        ? "bg-[#121212] text-[#fafafa]"
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
                      const senderUmbraDisabled =
                        p === "umbra" && umbraStatus !== "registered";
                      const recipientUmbraDisabled =
                        p === "umbra" &&
                        recipientUmbraStatus === "unregistered";
                      const isUmbraDisabled =
                        senderUmbraDisabled || recipientUmbraDisabled;
                      return (
                        <button
                          key={p}
                          onClick={() => {
                            if (isUmbraDisabled) return;
                            setProvider(p);
                          }}
                          disabled={isUmbraDisabled}
                          className={`flex-1 min-w-[72px] h-9 rounded-full text-xs font-medium transition-all flex items-center justify-center ${
                            provider === p
                              ? "bg-[#121212] text-[#fafafa]"
                              : isUmbraDisabled
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
                {umbraStatus === "unregistered" && (
                  <p className="text-xs text-[#121212]/50 mt-2">
                    Enable Umbra in your{" "}
                    <a
                      href="/p"
                      className="underline underline-offset-2 decoration-dashed hover:text-[#121212]"
                    >
                      profile
                    </a>{" "}
                    to send via Umbra.
                  </p>
                )}
                {umbraStatus === "registered" &&
                  recipientUmbraStatus === "checking" && (
                    <p className="text-xs text-[#121212]/40 mt-2">
                      Checking recipient on Umbra…
                    </p>
                  )}
                {umbraStatus === "registered" &&
                  recipientUmbraStatus === "unregistered" && (
                    <p className="text-xs text-[#121212]/50 mt-2">
                      Recipient is not registered on Umbra
                    </p>
                  )}
              </div>

              {/* Amount Details */}
              <div className="space-y-2 mb-8">
                <div className="flex justify-between">
                  <span className="text-[#121212]">Amount</span>
                  <span className="text-[#121212]">
                    {formatNumber(numAmount)} USDC
                  </span>
                </div>
                {provider === "auto" &&
                  ((recipientType === "wallet" && isValidAddress) ||
                    (recipientType === "x" && isValidXHandle)) && (
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
                    <span className="text-[#121212]">Partner Fees</span>
                    <span className="text-[#121212]/40 text-xs ml-1">
                      ({feeBreakdown})
                    </span>
                  </div>
                  <span className="text-[#121212]">
                    ~{formatNumber(partnerFee)} USDC
                  </span>
                </div>
                {chargedOnTop && (
                  <div className="flex justify-between">
                    <span className="text-[#121212]">You Pay</span>
                    <span className="text-[#121212]">
                      ~{formatNumber(senderCost)} USDC
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[#121212] font-semibold">
                    They Receive
                  </span>
                  <span className="text-[#121212] font-semibold">
                    ~{formatNumber(theyReceive)} USDC
                  </span>
                </div>
              </div>

              {/* Fee-aware balance warning */}
              {exceedsBalanceWithFee && (
                <div className="-mt-4 mb-6 text-sm text-red-500">
                  Amount + fee (~{formatNumber(senderCost)} USDC) exceeds your
                  balance.
                  {maxSendable !== null && maxSendable > 0 && (
                    <>
                      {" "}
                      <button
                        onClick={() => onUseMaxAmount(String(maxSendable))}
                        className="underline underline-offset-2 decoration-dashed hover:text-red-600"
                      >
                        Send max ({formatNumber(maxSendable)} USDC)
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Proceed Button */}
              <motion.button
                onClick={handleProceed}
                disabled={!canProceed || isResolvingX || umbraBlockedByRecipient}
                whileTap={{ scale: 0.98 }}
                className="w-full h-10 bg-[#121212] rounded-full flex items-center justify-center text-[#fafafa] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
              >
                {isResolvingX ? "Resolving..." : "Proceed"}
              </motion.button>

              {/* Generate Claim Link - invisible for X sends */}
              <button
                onClick={() => {
                  handleClose();
                  onSendViaClaim();
                }}
                disabled={recipientType === "x"}
                className={`w-full mt-4 text-[#121212]/70 text-sm underline underline-offset-4 decoration-dashed hover:text-[#121212] transition-colors ${recipientType === "x" ? "invisible pointer-events-none" : ""}`}
              >
                Generate a claim link
              </button>
            </motion.div>
          )}

          {state === "loading" && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-12"
            >
              <Spinner size={48} color="#121212" />
              <p className="mt-4 text-[#121212]/70">
                {provider === "umbra"
                  ? umbraSendState.stage === "checking-recipient"
                    ? "Checking recipient on Umbra..."
                    : umbraSendState.stage === "depositing"
                      ? "Sign each prompt to send privately"
                      : umbraSendState.stage === "recording"
                        ? "Finalizing..."
                        : "Preparing private send..."
                  : "Processing transaction..."}
              </p>
              {provider === "umbra" && umbraSendState.stage === "depositing" && (
                <p className="mt-1 text-[#121212]/50 text-xs">
                  ~3 wallet prompts total
                </p>
              )}
            </motion.div>
          )}

          {state === "success" && (
            <motion.div
              key="success"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Success Details */}
              <div className="space-y-2 mb-8">
                <div className="flex justify-between">
                  <span className="text-[#121212]">Sent To</span>
                  <span className="text-[#121212]">{displayRecipient}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#121212]">Amount</span>
                  <span className="text-[#121212]">
                    {formatNumber(numAmount)} USDC
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#121212]">Partner Fees</span>
                  <span className="text-[#121212]">
                    ~{formatNumber(partnerFee)} USDC
                  </span>
                </div>
                {chargedOnTop && (
                  <div className="flex justify-between">
                    <span className="text-[#121212]">You Pay</span>
                    <span className="text-[#121212]">
                      ~{formatNumber(senderCost)} USDC
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[#121212] font-semibold">
                    They Receive
                  </span>
                  <span className="text-[#121212] font-semibold">
                    ~{formatNumber(theyReceive)} USDC
                  </span>
                </div>
              </div>

              {/* Success Button */}
              <motion.button
                onClick={handleClose}
                whileTap={{ scale: 0.98 }}
                className="w-full h-10 bg-[#fafafa] border border-[#121212]/70 rounded-full flex items-center justify-center shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
              >
                <Image
                  src="/assets/success-alt.svg"
                  alt="Success"
                  width={24}
                  height={24}
                />
              </motion.button>
            </motion.div>
          )}

          {state === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-8"
            >
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
                <span className="text-red-500 text-2xl">!</span>
              </div>
              <p className="text-[#121212] font-medium mb-2">
                Transaction Failed
              </p>
              <p className="text-[#121212]/60 text-sm text-center mb-6">
                {errorMessage || "Something went wrong"}
              </p>
              <motion.button
                onClick={handleRetry}
                whileTap={{ scale: 0.98 }}
                className="w-full h-10 bg-[#121212] rounded-full flex items-center justify-center text-[#fafafa] font-semibold shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
              >
                Try Again
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </Modal>

      {/* QR Scanner Modal */}
      {showQRScanner && (
        <QRScanner
          isOpen={showQRScanner}
          onClose={() => setShowQRScanner(false)}
          onScan={handleQRScan}
        />
      )}
    </>
  );
}
