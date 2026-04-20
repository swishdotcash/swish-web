"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import { PublicKey } from "@solana/web3.js";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { QRScanner } from "./QRScanner";
import { SuccessParticles } from "./SuccessParticles";
import { formatNumber } from "@/utils";
import { useSendTransaction } from "@/hooks/useSendTransaction";
import { useFee } from "@/hooks/useFee";
import { fadeUp, scaleIn } from "@/lib/motionVariants";

interface SendModalProps {
  isOpen: boolean;
  onClose: () => void;
  amount: string;
  onSendViaClaim: () => void;
  signature: string | null;
  senderPublicKey: string | null;
}

type ModalState = "input" | "loading" | "success" | "error";
type RecipientType = "wallet" | "x";

export function SendModal({
  isOpen,
  onClose,
  amount,
  onSendViaClaim,
  signature,
  senderPublicKey,
}: SendModalProps) {
  const [walletAddress, setWalletAddress] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [recipientType, setRecipientType] = useState<RecipientType>("wallet");
  const [state, setState] = useState<ModalState>("input");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [isResolvingX, setIsResolvingX] = useState(false);
  const { send } = useSendTransaction();
  const { baseFee, feePercent } = useFee();

  const numAmount = parseFloat(amount) || 0;
  const partnerFee = baseFee + numAmount * feePercent;
  const total = numAmount - partnerFee;

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

  const canProceed =
    recipientType === "wallet" ? isValidAddress : isValidXHandle;

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
    if (!canProceed || !signature || !senderPublicKey) return;

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

      await send({
        receiverAddress,
        amount: numAmount,
        token: "USDC",
        signature,
        senderPublicKey,
      });
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
    setErrorMessage(null);
    setIsResolvingX(false);
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
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              exit="exit"
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
                    <label htmlFor="send-wallet-address" className="text-sm text-[#121212]/50 mb-1 block">
                      Enter wallet address
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="send-wallet-address"
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
                  </>
                ) : (
                  <>
                    <label htmlFor="send-x-handle" className="text-sm text-[#121212]/50 mb-1 block">
                      Enter X profile (without @)
                    </label>
                    <input
                      id="send-x-handle"
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

              {/* Amount Details */}
              <div className="space-y-2.5 mb-8">
                <div className="flex justify-between">
                  <span className="text-[#121212]">Amount</span>
                  <span className="text-[#121212]">{formatNumber(numAmount)} USDC</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#121212]/70 text-sm">Network Fee</span>
                  <span className="text-[#121212]/70 text-sm">~{formatNumber(baseFee)} USDC</span>
                </div>
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[#121212]/70 text-sm">Privacy Routing</span>
                    <p className="text-[#121212]/40 text-xs mt-0.5">Hides sender address</p>
                  </div>
                  <span className="text-[#121212]/70 text-sm">~{formatNumber(numAmount * feePercent)} USDC</span>
                </div>
                <div className="h-px bg-[#121212]/8" />
                <div className="flex justify-between">
                  <span className="text-[#121212] font-semibold">They Receive</span>
                  <span className="text-[#121212] font-semibold">~{formatNumber(total)} USDC</span>
                </div>
              </div>

              {/* Proceed Button */}
              <motion.button
                onClick={handleProceed}
                disabled={!canProceed || isResolvingX}
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
              variants={scaleIn}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="flex flex-col items-center justify-center py-12"
            >
              <Spinner size={48} color="#121212" />
              <p className="mt-4 text-[#121212]/70">
                Processing transaction...
              </p>
            </motion.div>
          )}

          {state === "success" && (
            <motion.div
              key="success"
              variants={scaleIn}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative"
            >
              <SuccessParticles />
              {/* Success Details */}
              <div className="space-y-2.5 mb-4">
                <div className="flex justify-between">
                  <span className="text-[#121212]">Sent To</span>
                  <span className="text-[#121212]">{displayRecipient}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#121212]">Amount</span>
                  <span className="text-[#121212]">{formatNumber(numAmount)} USDC</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#121212]/70 text-sm">Fees</span>
                  <span className="text-[#121212]/70 text-sm">~{formatNumber(partnerFee)} USDC</span>
                </div>
                <div className="h-px bg-[#121212]/8" />
                <div className="flex justify-between">
                  <span className="text-[#121212] font-semibold">They Received</span>
                  <span className="text-[#121212] font-semibold">~{formatNumber(total)} USDC</span>
                </div>
              </div>

              {/* Privacy confirmation */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#121212]/5 mb-4">
                <svg width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden="true">
                  <path d="M6 0.5L0.5 2.75V6.5C0.5 9.7 2.9 12.7 6 13.5C9.1 12.7 11.5 9.7 11.5 6.5V2.75L6 0.5Z" fill="#121212" fillOpacity="0.5" />
                </svg>
                <p className="text-xs text-[#121212]/60">
                  Sent privately — your wallet address was not revealed.
                </p>
              </div>

              {/* Success Button */}
              <motion.button
                onClick={handleClose}
                whileTap={{ scale: 0.98 }}
                className="w-full h-10 bg-[#fafafa] border border-[#121212]/70 rounded-full flex items-center justify-center shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
                aria-label="Done"
              >
                <Image
                  src="/assets/success-alt.svg"
                  alt="Done"
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
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              exit="exit"
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
