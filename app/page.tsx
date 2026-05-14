"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import { useSessionSignature } from "@/hooks/useSessionSignature";
import { useUSDCBalance } from "@/hooks/useUSDCBalance";
import { useUserRegistration } from "@/hooks/useUserRegistration";
import { formatNumber } from "@/utils";
import {
  ActionButton,
  NumberPad,
  SendModal,
  ReceiveModal,
  SendClaimModal,
} from "@/components";

type ModalType = "send" | "receive" | "sendClaim" | null;

export default function Home() {
  const { login, authenticated, logout, user } = usePrivy();
  const { walletAddress, getSignature } = useSessionSignature();
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

  const isXUser = !!user?.twitter;
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
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const formatAddr = (addr: string) => {
    if (addr.length <= 10) return addr;
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  const getBalanceDisplay = useCallback(() => {
    if (!authenticated) return "Connect Wallet";
    if (balanceLoading || !walletAddress) return "Loading...";
    if (balance !== null) return `${formatNumber(balance)} USDC`;
    return "0 USDC";
  }, [authenticated, balanceLoading, balance, walletAddress]);

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
        {/* Amount Display */}
        <div className="flex flex-col items-center mb-8 w-full max-w-full">
          <div className="w-full max-w-[320px] overflow-x-auto scrollbar-hide">
            <input
              type="text"
              value={`$${amount}`}
              readOnly
              disabled
              className="w-full text-6xl font-light text-[#121212] bg-transparent border-none outline-none text-center cursor-default select-none caret-transparent"
            />
          </div>

          {/* Balance / Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={handleBalanceClick}
              className={`mt-2 flex items-center gap-1.5 text-sm text-[#121212]/50 hover:text-[#121212]/70 transition-colors ${!authenticated ? "underline underline-offset-4 decoration-dashed" : ""}`}
            >
              {getBalanceDisplay()}
              {authenticated && (
                <Image
                  src="/assets/chevron-down-icon.svg"
                  alt=""
                  width={10}
                  height={10}
                  className={`transition-transform ${showDropdown ? "rotate-180" : ""}`}
                />
              )}
            </button>

            <AnimatePresence>
              {showDropdown && authenticated && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
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
                      {walletAddress ? formatAddr(walletAddress) : ""}
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
          <motion.div
            className="flex-1"
            animate={
              authenticated && (!hasValidAmount || exceedsBalance)
                ? { x: [0, -4, 4, -4, 4, 0] }
                : {}
            }
            transition={{ duration: 0.4 }}
            key={`send-${authenticated && (!hasValidAmount || exceedsBalance) ? "shake" : "idle"}`}
          >
            <ActionButton
              variant="send"
              onClick={() => handleActionClick("send")}
              disabled={authenticated && (!hasValidAmount || exceedsBalance)}
            />
          </motion.div>
          <motion.div
            className="flex-1"
            animate={
              authenticated && !hasValidAmount
                ? { x: [0, -4, 4, -4, 4, 0] }
                : {}
            }
            transition={{ duration: 0.4 }}
            key={`receive-${authenticated && !hasValidAmount ? "shake" : "idle"}`}
          >
            <ActionButton
              variant="receive"
              onClick={() => handleActionClick("receive")}
              disabled={authenticated && !hasValidAmount}
            />
          </motion.div>
        </div>
      </main>

      {/* Modals - only render when active to avoid multiple hook instances */}
      {activeModal === "send" && (
        <SendModal
          isOpen={true}
          onClose={closeModal}
          amount={amount}
          balance={balance}
          onUseMaxAmount={setAmount}
          onSendViaClaim={() => setActiveModal("sendClaim")}
          getSignature={getSignature}
        />
      )}

      {activeModal === "receive" && (
        <ReceiveModal
          isOpen={true}
          onClose={closeModal}
          amount={amount}
          getSignature={getSignature}
        />
      )}

      {activeModal === "sendClaim" && (
        <SendClaimModal
          isOpen={true}
          onClose={closeModal}
          amount={amount}
          balance={balance}
          onUseMaxAmount={setAmount}
          getSignature={getSignature}
        />
      )}
    </>
  );
}
