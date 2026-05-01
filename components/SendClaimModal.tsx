"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { formatNumber } from "@/utils";
import { useSendClaimTransaction } from "@/hooks/useSendClaimTransaction";
import { useProtocolFee } from "@/hooks/useProtocolFee";
import { useUmbraStatus } from "@/hooks/useUmbraStatus";
import {
  useSessionSignature,
  type GetSessionSignature,
} from "@/hooks/useSessionSignature";

interface SendClaimModalProps {
  isOpen: boolean;
  onClose: () => void;
  amount: string;
  getSignature: GetSessionSignature;
}

type ModalState = "input" | "loading" | "success" | "error";
type ProviderChoice = "auto" | "privacy-cash" | "magicblock-per" | "umbra";

export function SendClaimModal({
  isOpen,
  onClose,
  amount,
  getSignature,
}: SendClaimModalProps) {
  const [message, setMessage] = useState("");
  const [state, setState] = useState<ModalState>("input");
  const [claimLink, setClaimLink] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [provider, setProvider] = useState<ProviderChoice>("auto");
  const { sendClaim } = useSendClaimTransaction();
  const { status: umbraStatus } = useUmbraStatus();
  // Each protocol's SC reclaim uses its own session message — the burner
  // privkey is encrypted with the sender's protocol-specific signature so
  // we must mint the right one when the user picks MB or Umbra. PC's
  // getSignature is the parent prop fallback for "auto" and "privacy-cash".
  const { getSignature: getMbSessionSignature } =
    useSessionSignature("magicblock-per");
  const { getSignature: getUmbraSessionSignature } =
    useSessionSignature("umbra");

  const numAmount = parseFloat(amount) || 0;
  // Per-protocol fee. SC has different fee structure than direct send:
  //   PC: base + 0.35% (deducted from claim)
  //   MB: gas only
  //   Umbra: 0.7% on claim (protocol + relayer)
  const { feeUSDC: partnerFee, breakdown: feeBreakdown } = useProtocolFee(
    provider,
    numAmount,
    "send_claim"
  );
  const total = numAmount - partnerFee;

  const handleProceed = async () => {
    // Pick the right session-sig hook for the chosen provider. Each
    // protocol has its own session message (MB and Umbra), so we must
    // mint the matching sig. PC + auto fall back to the parent prop
    // (which uses PC's hook).
    const session =
      provider === "umbra"
        ? await getUmbraSessionSignature()
        : provider === "magicblock-per"
          ? await getMbSessionSignature()
          : await getSignature();
    if (!session) {
      setErrorMessage("Signature required to continue");
      setState("error");
      return;
    }

    setState("loading");
    setErrorMessage(null);

    try {
      const result = await sendClaim({
        amount: numAmount,
        token: "USDC",
        message: message.trim() || undefined,
        signature: session.signature,
        senderPublicKey: session.address,
        providerId: provider,
      });

      setClaimLink(result.claimLink);
      setPassphrase(result.passphrase);
      setState("success");
    } catch (error: any) {
      console.error("Send claim failed:", error);
      setErrorMessage(error.message || "Something went wrong");
      setState("error");
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${claimLink}\n\nPassphrase: ${passphrase}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const handleClose = () => {
    setState("input");
    setMessage("");
    setClaimLink("");
    setPassphrase("");
    setErrorMessage(null);
    setCopied(false);
    setProvider("auto");
    onClose();
  };

  const handleRetry = () => {
    setState("input");
    setErrorMessage(null);
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Image src="/assets/send.svg" alt="Send" width={24} height={24} className="invert" />
        <h2 className="text-2xl font-semibold text-[#121212]">Send via Claim</h2>
      </div>

      <AnimatePresence mode="wait">
        {state === "input" && (
          <motion.div
            key="input"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Message Input */}
            <div className="mb-6">
              <label className="text-sm text-[#121212]/50 mb-2 block">
                Add message (optional)
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => {
                    if (e.target.value.length <= 50) setMessage(e.target.value);
                  }}
                  maxLength={50}
                  placeholder=""
                  className="w-full h-12 px-4 pr-16 rounded-full border border-[#121212]/10 bg-transparent text-[#121212] outline-none focus:border-[#121212]/30 transition-colors"
                />
                <span className={`absolute right-4 top-1/2 -translate-y-1/2 text-xs ${message.length >= 50 ? "text-red-500" : "text-[#121212]/30"}`}>
                  {message.length}/50
                </span>
              </div>
            </div>

            {/* Privacy provider picker */}
            <div className="mb-6">
              <label className="text-sm text-[#121212]/50 mb-1 block">
                Privacy protocol
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {(
                  [
                    "auto",
                    "privacy-cash",
                    "magicblock-per",
                    "umbra",
                  ] as ProviderChoice[]
                ).map((p) => {
                  const isUmbraDisabled =
                    p === "umbra" && umbraStatus !== "registered";
                  const label =
                    p === "auto"
                      ? "Auto"
                      : p === "privacy-cash"
                        ? "Privacy Cash"
                        : p === "magicblock-per"
                          ? "MagicBlock"
                          : "Umbra";
                  return (
                    <button
                      key={p}
                      onClick={() => {
                        if (isUmbraDisabled) return;
                        setProvider(p);
                      }}
                      disabled={isUmbraDisabled}
                      className={`flex-1 min-w-[72px] h-9 rounded-full text-xs font-medium transition-all ${
                        provider === p
                          ? "bg-[#121212] text-[#fafafa]"
                          : isUmbraDisabled
                            ? "bg-[#121212]/5 text-[#121212]/30 cursor-not-allowed"
                            : "bg-[#121212]/5 text-[#121212]/70 hover:bg-[#121212]/10"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
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
            </div>

            {/* Amount Details */}
            <div className="space-y-3 mb-8">
              <div className="flex justify-between">
                <span className="text-[#121212]">Amount</span>
                <span className="text-[#121212]">{formatNumber(numAmount)} USDC</span>
              </div>
              <div className="flex justify-between">
                <div>
                  <span className="text-[#121212]">Partner Fees</span>
                  <span className="text-[#121212]/40 text-xs ml-1">
                    ({feeBreakdown})
                  </span>
                </div>
                <span className="text-[#121212]">~{formatNumber(partnerFee)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#121212] font-semibold">They Receive</span>
                <span className="text-[#121212] font-semibold">~{formatNumber(total)} USDC</span>
              </div>
            </div>

            {/* Proceed Button */}
            <motion.button
              onClick={handleProceed}
              whileTap={{ scale: 0.98 }}
              className="w-full h-10 bg-[#121212] rounded-full flex items-center justify-center text-[#fafafa] font-semibold transition-opacity shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
            >
              Proceed
            </motion.button>
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
            <p className="mt-4 text-[#121212]/70">Generating claim link...</p>
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
            <div className="space-y-3 mb-6">
              <div className="flex justify-between">
                <span className="text-[#121212]">Amount</span>
                <span className="text-[#121212]">{formatNumber(numAmount)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#121212]">Partner Fees</span>
                <span className="text-[#121212]">~{formatNumber(partnerFee)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#121212] font-semibold">They Receive</span>
                <span className="text-[#121212] font-semibold">~{formatNumber(total)} USDC</span>
              </div>
            </div>

            {/* Copy Link Button */}
            <motion.button
              onClick={copied ? undefined : handleCopyLink}
              whileTap={copied ? {} : { scale: 0.98 }}
              className={`w-full h-10 bg-[#121212] rounded-full flex items-center justify-center gap-2 text-[#fafafa] font-semibold shadow-[0_4px_12px_rgba(18,18,18,0.15)] ${copied ? "pointer-events-none" : ""}`}
            >
              <Image
                src={copied ? "/assets/success.svg" : "/assets/copy-icon.svg"}
                alt=""
                width={copied ? 16 : 16}
                height={copied ? 8 : 16}
                className={copied ? "" : "invert"}
              />
              {copied ? "Copied!" : "Copy Claim Link"}
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
            <p className="text-[#121212] font-medium mb-2">Failed to Generate Link</p>
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
  );
}
