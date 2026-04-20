"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import { PublicKey } from "@solana/web3.js";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { QRScanner } from "./QRScanner";
import { formatNumber } from "@/utils";
import { useWithdrawTransaction } from "@/hooks/useWithdrawTransaction";

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  usdcBalance: number;
  signature: string | null;
  senderPublicKey: string | null;
}

type ModalState = "input" | "loading" | "success" | "error";

export function WithdrawModal({
  isOpen,
  onClose,
  usdcBalance,
  signature,
  senderPublicKey,
}: WithdrawModalProps) {
  const [walletAddress, setWalletAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [state, setState] = useState<ModalState>("input");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const { withdraw } = useWithdrawTransaction();

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

  const isValidAmount = numAmount > 0 && numAmount <= usdcBalance;
  const canProceed = isValidAddress && isValidAmount;

  const handleProceed = async () => {
    if (!canProceed || !signature || !senderPublicKey) return;

    setState("loading");
    setErrorMessage(null);

    try {
      await withdraw({
        receiverAddress: walletAddress,
        amount: numAmount,
        signature,
        senderPublicKey,
      });
      setState("success");
    } catch (error: any) {
      console.error("Withdraw failed:", error);
      setErrorMessage(error.message || "Withdraw failed");
      setState("error");
    }
  };

  const handleClose = () => {
    setState("input");
    setWalletAddress("");
    setAmount("");
    setErrorMessage(null);
    onClose();
  };

  const handleRetry = () => {
    setState("input");
    setErrorMessage(null);
  };

  const handleMax = () => {
    setAmount(String(usdcBalance));
  };

  const handleQRScan = (address: string) => {
    setWalletAddress(address);
    setShowQRScanner(false);
  };

  const formatAddress = (address: string) => {
    if (address.length <= 10) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleClose}>
        {/* Header */}
        <div className="flex items-center gap-2 mb-6">
          <Image
            src="/assets/send.svg"
            alt="Withdraw"
            width={24}
            height={24}
            className="invert"
          />
          <h2 className="text-2xl font-semibold text-[#121212]">Withdraw</h2>
        </div>

        <AnimatePresence mode="wait">
          {state === "input" && (
            <motion.div
              key="input"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Wallet Address Input */}
              <div className="mb-4">
                <label htmlFor="withdraw-wallet-address" className="text-sm text-[#121212]/50 mb-1 block">
                  Destination wallet address
                </label>
                <div className="flex gap-2">
                  <input
                    id="withdraw-wallet-address"
                    type="text"
                    value={walletAddress}
                    onChange={(e) => setWalletAddress(e.target.value)}
                    placeholder=""
                    className="flex-1 h-12 px-4 rounded-full border border-[#121212]/10 bg-transparent text-[#121212] outline-none focus:border-[#121212]/30 transition-colors"
                  />
                  <button
                    onClick={() => setShowQRScanner(true)}
                    aria-label="Scan QR code"
                    className="w-12 h-12 rounded-full border border-[#121212]/10 flex items-center justify-center hover:bg-[#121212]/5 transition-colors shrink-0"
                  >
                    <Image
                      src="/assets/scan-icon.svg"
                      alt=""
                      aria-hidden="true"
                      width={20}
                      height={20}
                    />
                  </button>
                </div>
              </div>

              {/* Amount Input */}
              <div className="mb-6">
                <label htmlFor="withdraw-amount" className="text-sm text-[#121212]/50 mb-1 block">
                  Amount (USDC)
                </label>
                <div className="flex gap-2">
                  <input
                    id="withdraw-amount"
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="flex-1 h-12 px-4 rounded-full border border-[#121212]/10 bg-transparent text-[#121212] outline-none focus:border-[#121212]/30 transition-colors"
                  />
                  <button
                    onClick={handleMax}
                    className="h-12 px-4 rounded-full border border-[#121212]/10 text-[#121212]/70 text-sm font-medium hover:bg-[#121212]/5 transition-colors shrink-0"
                  >
                    Max
                  </button>
                </div>
                <p className="text-xs text-[#121212]/40 mt-1 ml-4">
                  Available: {formatNumber(usdcBalance)} USDC
                </p>
              </div>

              {/* Summary */}
              <div className="space-y-2 mb-8">
                <div className="flex justify-between">
                  <span className="text-[#121212]">Amount</span>
                  <span className="text-[#121212]">
                    {formatNumber(numAmount)} USDC
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#121212]">Network Fee</span>
                  <span className="text-[#121212]">Sponsored</span>
                </div>
              </div>

              {/* Proceed Button */}
              <motion.button
                onClick={handleProceed}
                disabled={!canProceed}
                whileTap={{ scale: 0.98 }}
                className="w-full h-10 bg-[#121212] rounded-full flex items-center justify-center text-[#fafafa] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
              >
                Withdraw
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
                Processing withdrawal...
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
                  <span className="text-[#121212]">Sent To</span>
                  <span className="text-[#121212]">
                    {formatAddress(walletAddress)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#121212]">Amount</span>
                  <span className="text-[#121212]">
                    {formatNumber(numAmount)} USDC
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#121212]">Network Fee</span>
                  <span className="text-[#121212]">Sponsored</span>
                </div>
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
              role="alert"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-8"
            >
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
                <span className="text-red-500 text-2xl">!</span>
              </div>
              <p className="text-[#121212] font-medium mb-2">
                Withdrawal Failed
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
