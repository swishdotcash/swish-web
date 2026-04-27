"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { formatNumber } from "@/utils";
import { useFee } from "@/hooks/useFee";
import type { GetSessionSignature } from "@/hooks/useSessionSignature";

interface ReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  amount: string;
  getSignature: GetSessionSignature;
}

type ModalState = "input" | "loading" | "success" | "error";

export function ReceiveModal({
  isOpen,
  onClose,
  amount,
  getSignature,
}: ReceiveModalProps) {
  const [message, setMessage] = useState("");
  const [state, setState] = useState<ModalState>("input");
  const [requestLink, setRequestLink] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { baseFee, feePercent } = useFee();

  const numAmount = parseFloat(amount) || 0;
  const partnerFee = baseFee + numAmount * feePercent;
  const youReceive = numAmount - partnerFee;

  const handleProceed = async () => {
    const session = await getSignature();
    if (!session) {
      setErrorMessage("Signature required to continue");
      setState("error");
      return;
    }

    setState("loading");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/request/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Signature": session.signature,
        },
        body: JSON.stringify({
          requesterAddress: session.address,
          amount: numAmount,
          token: "USDC",
          message: message.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to create request");
      }

      const data = await res.json();
      setRequestLink(data.requestLink);
      setState("success");
    } catch (error: any) {
      console.error("Request failed:", error);
      setErrorMessage(error.message || "Something went wrong");
      setState("error");
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(requestLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const handleClose = () => {
    setState("input");
    setMessage("");
    setRequestLink("");
    setErrorMessage(null);
    setCopied(false);
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
        <Image src="/assets/receive.svg" alt="Request" width={24} height={24} className="invert" />
        <h2 className="text-2xl font-semibold text-[#121212]">Request</h2>
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

            {/* Amount Details */}
            <div className="space-y-3 mb-8">
              <div className="flex justify-between">
                <span className="text-[#121212]">Amount</span>
                <span className="text-[#121212]">{formatNumber(numAmount)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#121212]">Partner Fees</span>
                <span className="text-[#121212]">~{formatNumber(partnerFee)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#121212] font-semibold">You Receive</span>
                <span className="text-[#121212] font-semibold">~{formatNumber(youReceive)} USDC</span>
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
            <p className="mt-4 text-[#121212]/70">Generating request link...</p>
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
            <div className="space-y-3 mb-8">
              <div className="flex justify-between">
                <span className="text-[#121212]">Amount</span>
                <span className="text-[#121212]">{formatNumber(numAmount)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#121212]">Partner Fees</span>
                <span className="text-[#121212]">~{formatNumber(partnerFee)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#121212] font-semibold">You Receive</span>
                <span className="text-[#121212] font-semibold">~{formatNumber(youReceive)} USDC</span>
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
              {copied ? "Copied!" : "Copy Request Link"}
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
            <p className="text-[#121212] font-medium mb-2">Request Failed</p>
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
