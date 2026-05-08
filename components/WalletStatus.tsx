"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import { usePrivy } from "@privy-io/react-auth";
import { useSessionSignature } from "@/hooks/useSessionSignature";
import { useUSDCBalance } from "@/hooks/useUSDCBalance";
import { formatNumber } from "@/utils";

export function WalletStatus() {
  const { login, authenticated, logout, user } = usePrivy();
  const { walletAddress } = useSessionSignature();
  const { balance, isLoading: balanceLoading } = useUSDCBalance(walletAddress);
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isXUser = !!user?.twitter;
  const twitterHandle = user?.twitter?.username;

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
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleBalanceClick}
        className={`flex items-center gap-1.5 text-sm text-[#121212]/50 hover:text-[#121212]/70 transition-colors ${!authenticated ? "underline underline-offset-4 decoration-dashed" : ""}`}
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
  );
}
