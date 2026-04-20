"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { formatNumber } from "@/utils";
import { useFee } from "@/hooks/useFee";

interface ClaimPassphraseModalProps {
  isOpen: boolean;
  onClose: () => void;
  amount: number;
  activityId: string;
  receiverAddress: string;
  onSuccess: () => void;
}

type ModalState = "input" | "loading" | "success" | "error";

export function ClaimPassphraseModal({
  isOpen,
  onClose,
  amount,
  activityId,
  receiverAddress,
  onSuccess,
}: ClaimPassphraseModalProps) {
  const [passphrase, setPassphrase] = useState("");
  const [state, setState] = useState<ModalState>("input");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { baseFee, feePercent } = useFee();

  const partnerFee = baseFee + amount * feePercent;
  const total = amount - partnerFee;

  const handleProceed = async () => {
    if (!passphrase.trim()) return;

    setState("loading");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/send_claim/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityId,
          passphrase: passphrase.trim(),
          receiverAddress,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to claim");
      }

      setState("success");
      onSuccess();
    } catch (error: any) {
      console.error("Claim failed:", error);
      setErrorMessage(error.message || "Failed to claim");
      setState("error");
    }
  };

  const handleClose = () => {
    setState("input");
    setPassphrase("");
    setErrorMessage(null);
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
        <Image src="/assets/receive.svg" alt="Claim" width={24} height={24} className="invert" />
        <h2 className="text-2xl font-semibold text-[#121212]">Claim</h2>
      </div>

      <AnimatePresence mode="wait">
        {state === "input" && (
          <motion.div
            key="input"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Passphrase Input */}
            <div className="mb-6">
              <label htmlFor="claim-passphrase" className="text-sm text-[#121212]/50 mb-1 block">
                Enter passphrase
              </label>
              <input
                id="claim-passphrase"
                type="text"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder=""
                className="w-full h-12 px-4 rounded-full border border-[#121212]/10 bg-transparent text-[#121212] outline-none focus:border-[#121212]/30 transition-colors"
              />
            </div>

            {/* Amount Details */}
            <div className="space-y-2 mb-8">
              <div className="flex justify-between">
                <span className="text-[#121212]">Amount</span>
                <span className="text-[#121212]">{formatNumber(amount)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#121212]">Partner Fees</span>
                <span className="text-[#121212]">~{formatNumber(partnerFee)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#121212] font-semibold">Total</span>
                <span className="text-[#121212] font-semibold">~{formatNumber(total)} USDC</span>
              </div>
            </div>

            {/* Proceed Button */}
            <motion.button
              onClick={handleProceed}
              disabled={!passphrase.trim()}
              whileTap={{ scale: 0.98 }}
              className="w-full h-10 bg-[#121212] rounded-full flex items-center justify-center text-[#fafafa] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
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
            <p className="mt-4 text-[#121212]/70">Processing claim...</p>
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
                <span className="text-[#121212]">Amount</span>
                <span className="text-[#121212]">{formatNumber(amount)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#121212]">Partner Fees</span>
                <span className="text-[#121212]">~{formatNumber(partnerFee)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#121212] font-semibold">Total</span>
                <span className="text-[#121212] font-semibold">~{formatNumber(total)} USDC</span>
              </div>
            </div>

            {/* Success Button */}
            <motion.button
              onClick={handleClose}
              whileTap={{ scale: 0.98 }}
              className="w-full h-10 bg-[#fafafa] border border-[#121212]/70 rounded-full flex items-center justify-center shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
            >
              <Image src="/assets/success-alt.svg" alt="Success" width={24} height={24} />
            </motion.button>
          </motion.div>
        )}

        {state === "error" && (
          <motion.div
            key="error"
            role="alert"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-8"
          >
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
              <span className="text-red-500 text-2xl">!</span>
            </div>
            <p className="text-[#121212] font-medium mb-2">Claim Failed</p>
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
