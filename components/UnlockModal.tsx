"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { formatNumber } from "@/utils";
import {
  useUmbraUnlock,
  type UmbraUnlockStage,
} from "@/hooks/useUmbraUnlock";

interface UnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Total available shielded balance in USDC (claimed + pending). */
  availableUSDC: number;
  /** Same total in base units. Used as the Max value. */
  availableBaseUnits: bigint;
  /** Whether any pending UTXOs need to be claimed first. Affects copy. */
  hasPending: boolean;
  /** Called after a successful unlock so the parent can refetch state. */
  onSuccess?: () => void;
}

type ModalState = "input" | "loading" | "success" | "error";

const stageLabel = (
  stage: UmbraUnlockStage,
  hasPending: boolean
): string => {
  switch (stage) {
    case "scanning":
      return hasPending ? "Looking for incoming funds…" : "Preparing…";
    case "claiming":
      return "Claiming pending funds…";
    case "settling":
      return "Waiting for Arcium to settle (~10–15s)…";
    case "withdrawing":
      return "Withdrawing to your wallet…";
    case "settled":
      return "Done!";
    default:
      return "Preparing…";
  }
};

export function UnlockModal({
  isOpen,
  onClose,
  availableUSDC,
  availableBaseUnits,
  hasPending,
  onSuccess,
}: UnlockModalProps) {
  const [amountStr, setAmountStr] = useState("");
  const [state, setState] = useState<ModalState>("input");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { unlock, state: unlockState } = useUmbraUnlock();

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setAmountStr("");
      setState("input");
      setErrorMessage(null);
    }
  }, [isOpen]);

  const numAmount = parseFloat(amountStr) || 0;
  const exceedsAvailable = numAmount > availableUSDC;
  const canProceed = numAmount > 0 && !exceedsAvailable;

  const handleMax = () => {
    // Show the actual available amount, full precision. USDC has 6
    // decimals; toString trims trailing zeros (0.5 stays "0.5", 0.497123
    // stays "0.497123"). Honest about exactly what you'll receive.
    setAmountStr(availableUSDC.toString());
  };

  const handleProceed = async () => {
    if (!canProceed) return;

    setState("loading");
    setErrorMessage(null);

    try {
      // Convert USDC float → base units. Use Math.round to avoid float drift.
      const requestedBaseUnits = BigInt(Math.round(numAmount * 1_000_000));
      // Clamp to available so "Max" never sends 1 lamport more than what's there.
      const clamped =
        requestedBaseUnits > availableBaseUnits
          ? availableBaseUnits
          : requestedBaseUnits;
      await unlock({ amountBaseUnits: clamped });
      setState("success");
      onSuccess?.();
    } catch (err: any) {
      setErrorMessage(err?.message || "Unlock failed");
      setState("error");
    }
  };

  const handleClose = () => {
    setState("input");
    setAmountStr("");
    setErrorMessage(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <h2 className="text-2xl font-semibold text-[#121212]">Unlock</h2>
      </div>

      <AnimatePresence mode="wait">
        {state === "input" && (
          <motion.div
            key="input"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Amount input */}
            <div className="mb-4">
              <label className="text-sm text-[#121212]/50 mb-2 block">
                Amount
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountStr}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.]/g, "");
                    if (v.split(".").length > 2) return;
                    setAmountStr(v);
                  }}
                  placeholder="0"
                  className="w-full h-12 px-4 pr-20 rounded-full border border-[#121212]/10 bg-transparent text-[#121212] outline-none focus:border-[#121212]/30 transition-colors"
                />
                <button
                  onClick={handleMax}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-3 h-8 rounded-full bg-[#121212]/5 text-xs font-semibold text-[#121212] hover:bg-[#121212]/10 transition-colors"
                >
                  Max
                </button>
              </div>
              <p className="text-xs text-[#121212]/50 mt-2">
                Available: {formatNumber(availableUSDC)} USDC
                {hasPending ? " (incl. pending)" : ""}
              </p>
              {exceedsAvailable && (
                <p className="text-xs text-[#CB0000] mt-1">
                  Exceeds your available balance.
                </p>
              )}
            </div>

            {/* Details */}
            <div className="space-y-2 mb-8 mt-6">
              <div className="flex justify-between">
                <span className="text-[#121212]">Unlocking</span>
                <span className="text-[#121212]">
                  {formatNumber(numAmount)} USDC
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#121212] font-semibold">
                  You receive
                </span>
                <span className="text-[#121212] font-semibold">
                  {formatNumber(numAmount)} USDC
                </span>
              </div>
            </div>

            {/* Proceed Button */}
            <motion.button
              onClick={handleProceed}
              disabled={!canProceed}
              whileTap={{ scale: 0.98 }}
              className="w-full h-10 bg-[#121212] rounded-full flex items-center justify-center text-[#fafafa] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
            >
              Unlock
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
            <p className="mt-4 text-[#121212]/70">
              {stageLabel(unlockState.stage, hasPending)}
            </p>
            <p className="mt-2 text-[#121212]/40 text-xs">
              Don&apos;t close this window.
            </p>
          </motion.div>
        )}

        {state === "success" && (
          <motion.div
            key="success"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="space-y-2 mb-8">
              <div className="flex justify-between">
                <span className="text-[#121212]">Unlocked</span>
                <span className="text-[#121212]">
                  {formatNumber(numAmount)} USDC
                </span>
              </div>
              <p className="text-[#008834] text-xs">
                Funds heading to your wallet.
              </p>
            </div>

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
            <p className="text-[#121212] font-medium mb-2">Unlock Failed</p>
            <p className="text-[#121212]/60 text-sm text-center mb-6 break-words">
              {errorMessage?.split("\n")[0] || "Something went wrong"}
            </p>
            <motion.button
              onClick={() => setState("input")}
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
