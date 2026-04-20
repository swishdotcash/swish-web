"use client";

export const dynamic = "force-dynamic";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import lazyLoad from "next/dynamic";
import Image from "next/image";
import { useSessionSignature } from "@/hooks/useSessionSignature";
import { useUSDCBalance } from "@/hooks/useUSDCBalance";
import { useUserRegistration } from "@/hooks/useUserRegistration";
import { formatNumber } from "@/utils";
import { ActionButton } from "@/components/ActionButton";
import { NumberPad } from "@/components/NumberPad";
import { PrivacyBadge } from "@/components/PrivacyBadge";

const SendModal = lazyLoad(() => import("@/components/SendModal").then(m => ({ default: m.SendModal })), { ssr: false });
const ReceiveModal = lazyLoad(() => import("@/components/ReceiveModal").then(m => ({ default: m.ReceiveModal })), { ssr: false });
const SendClaimModal = lazyLoad(() => import("@/components/SendClaimModal").then(m => ({ default: m.SendClaimModal })), { ssr: false });

type ModalType = "send" | "receive" | "sendClaim" | null;

export default function Home() {
  const { login, authenticated, logout, user } = usePrivy();
  const { walletAddress, signature, address, needsSignature, error: signError, requestSignature } = useSessionSignature();
  useUserRegistration();
  const {
    balance,
    isLoading: balanceLoading,
    refetch: refetchUSDCBalance,
  } = useUSDCBalance(walletAddress);
  const [amount, setAmount] = useState("0");
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [signModalShake, setSignModalShake] = useState(false);

  const isXUser = !!user?.twitter;
  // Show mandatory sign-in modal for Twitter users who haven't signed yet
  const showSignModal = isXUser && authenticated && !signature && !!walletAddress;
  const twitterHandle = user?.twitter?.username;

  const numAmount = parseFloat(amount) || 0;
  const hasValidAmount = numAmount > 0;
  const exceedsBalance = balance !== null && numAmount > balance;

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showDropdown]);

  const handleNumberPress = (num: string) => {
    if (amount === "0" && num !== ".") {
      setAmount(num);
    } else if (num === "." && amount.includes(".")) {
      return;
    } else {
      setAmount(amount + num);
    }
  };

  const handleBackspace = () => {
    if (amount.length === 1) {
      setAmount("0");
    } else {
      setAmount(amount.slice(0, -1));
    }
  };

  const handleActionClick = (action: "send" | "receive") => {
    if (!authenticated) {
      login();
      return;
    }

    if (!hasValidAmount) {
      return;
    }

    if (action === "send" && exceedsBalance) {
      return;
    }

    setActiveModal(action);
  };

  const closeModal = () => {
    refetchUSDCBalance();
    setActiveModal(null);
  };

  const handleCopyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const formatAddr = (addr: string) => {
    if (addr.length <= 10) return addr;
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  const balanceDisplay = useMemo(() => {
    if (!authenticated) return "Connect Wallet";
    if (balance !== null) return `${formatNumber(balance)} USDC`;
    return "0 USDC";
  }, [authenticated, balance]);

  const handleBalanceClick = () => {
    if (!authenticated) {
      login();
      return;
    }
    setShowDropdown((prev) => !prev);
  };

  return (
    <>
      <main className="flex flex-col items-center p-4 w-full">
        {/* Privacy Badge */}
        <div className="mb-6">
          <PrivacyBadge />
        </div>

        {/* Amount Display */}
        <div className="flex flex-col items-center mb-8 w-full max-w-full">
          <div className="w-full max-w-[320px] overflow-x-auto scrollbar-hide flex justify-center">
            <motion.span
              key={amount}
              initial={{ scale: 1.08 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", damping: 18, stiffness: 500 }}
              className="text-6xl font-light text-[#121212] text-center select-none"
            >
              {amount}
            </motion.span>
          </div>

          {/* Balance / Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={handleBalanceClick}
              aria-label={authenticated ? `Available Balance: ${balanceDisplay}` : "Connect wallet"}
              className={`mt-2 flex items-center gap-1.5 text-sm text-[#121212]/50 hover:text-[#121212]/70 transition-colors ${!authenticated ? "underline underline-offset-4 decoration-dashed" : ""}`}
            >
              {authenticated && (balanceLoading || !walletAddress) ? (
                <span className="skeleton h-4 w-20 inline-block" aria-hidden="true" />
              ) : authenticated ? (
                <span>Available Balance: <span className="font-medium text-[#121212]/70">{balanceDisplay}</span></span>
              ) : (
                balanceDisplay
              )}
              {authenticated && (
                <motion.div
                  animate={{ rotate: showDropdown ? 180 : 0 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Image
                    src="/assets/chevron-down-icon.svg"
                    alt=""
                    width={10}
                    height={10}
                  />
                </motion.div>
              )}
            </button>

            <AnimatePresence>
              {showDropdown && authenticated && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.93, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0,
                             transition: { type: "spring", damping: 22, stiffness: 300 } }}
                  exit={{ opacity: 0, scale: 0.95, y: -4,
                          transition: { duration: 0.15, ease: [0.7, 0, 0.84, 0] } }}
                  className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 bg-[#fafafa] border border-[#121212]/10 rounded-2xl shadow-lg z-50 overflow-hidden"
                >
                  {/* Wallet Address */}
                  <button
                    onClick={copied ? undefined : handleCopyAddress}
                    className={`w-full flex items-center gap-2.5 px-4 py-3 transition-colors ${copied ? "pointer-events-none" : "hover:bg-[#121212]/5"}`}
                  >
                    <Image
                      src="/assets/sol-icon.svg"
                      alt=""
                      width={16}
                      height={16}
                    />
                    <span className="text-[#121212] text-md flex-1 text-left">
                      {address ? formatAddr(address) : ""}
                    </span>
                    <Image
                      src={copied ? "/assets/success-alt.svg" : "/assets/copy-icon.svg"}
                      alt=""
                      width={copied ? 16 : 14}
                      height={copied ? 8 : 14}
                    />
                  </button>

                  {/* X Handle */}
                  {isXUser && twitterHandle && (
                    <a
                      href={`https://x.com/${twitterHandle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-[#121212]/5 transition-colors"
                    >
                      <Image
                        src="/assets/x-icon.svg"
                        alt=""
                        width={16}
                        height={16}
                      />
                      <span className="text-[#121212]/60 text-sm">
                        @{twitterHandle}
                      </span>
                    </a>
                  )}

                  {/* Logout */}
                  <button
                    onClick={() => {
                      setShowDropdown(false);
                      logout();
                    }}
                    className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-[#121212]/5 transition-colors"
                  >
                    <Image
                      src="/assets/logout-icon.svg"
                      alt=""
                      width={16}
                      height={16}
                    />
                    <span className="text-[#121212] text-sm">Logout</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Number Pad */}
        <div className="mb-8 w-full flex justify-center">
          <NumberPad
            onNumberPress={handleNumberPress}
            onBackspace={handleBackspace}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 w-full">
          <ActionButton
            variant="send"
            onClick={() => handleActionClick("send")}
            disabled={authenticated && (!hasValidAmount || exceedsBalance)}
          />
          <ActionButton
            variant="receive"
            onClick={() => handleActionClick("receive")}
            disabled={authenticated && !hasValidAmount}
          />
        </div>
      </main>

      {/* Modals - only render when active to avoid multiple hook instances */}
      {activeModal === "send" && (
        <SendModal
          isOpen={true}
          onClose={closeModal}
          amount={amount}
          onSendViaClaim={() => setActiveModal("sendClaim")}
          signature={signature}
          senderPublicKey={address}
        />
      )}

      {activeModal === "receive" && (
        <ReceiveModal
          isOpen={true}
          onClose={closeModal}
          amount={amount}
          signature={signature}
          requesterAddress={address}
        />
      )}

      {activeModal === "sendClaim" && (
        <SendClaimModal
          isOpen={true}
          onClose={closeModal}
          amount={amount}
          signature={signature}
          senderPublicKey={address}
        />
      )}

      {/* Mandatory sign-in modal for Twitter users */}
      <AnimatePresence>
        {showSignModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/40 z-50 backdrop-blur-xs"
              onClick={() => {
                setSignModalShake(true);
                setTimeout(() => setSignModalShake(false), 500);
              }}
            />
            <motion.div
              initial={{ opacity: 0, y: "100%" }}
              animate={{
                opacity: 1,
                y: 0,
                x: signModalShake ? [0, -6, 6, -6, 6, 0] : 0,
              }}
              exit={{ opacity: 0, y: "100%" }}
              transition={
                signModalShake
                  ? { x: { duration: 0.4 }, type: "spring", damping: 25, stiffness: 300 }
                  : { type: "spring", damping: 25, stiffness: 300 }
              }
              className="fixed z-50 bg-[#fafafa] rounded-t-3xl md:rounded-3xl w-full max-w-[430px] bottom-0 left-1/2 -translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2"
            >
              <div className="flex justify-center pt-3 pb-2 md:hidden">
                <div className="w-10 h-1 bg-[#121212]/20 rounded-full" />
              </div>
              <div className="px-6 pb-8 pt-4 md:pt-6 flex flex-col items-center">
                <Image
                  src="/assets/logo.svg"
                  alt="Privacy Money"
                  width={48}
                  height={48}
                  className="mb-4"
                />
                <h2 className="text-lg font-semibold text-[#121212] mb-2">
                  Sign In Required
                </h2>
                <p className="text-sm text-[#121212]/60 text-center mb-6">
                  Please sign the message to verify your wallet and continue using Swish.
                </p>
                <motion.button
                  onClick={requestSignature}
                  whileTap={{ scale: 0.98 }}
                  className="w-full h-10 bg-[#121212] rounded-full flex items-center justify-center text-[#fafafa] font-semibold shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
                >
                  Sign In
                </motion.button>
                {signError && (
                  <p className="text-red-500 text-xs mt-3 text-center">{signError}</p>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
