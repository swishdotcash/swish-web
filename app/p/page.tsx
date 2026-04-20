"use client";

export const dynamic = "force-dynamic";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import lazyLoad from "next/dynamic";
import { staggerContainer, staggerItem, fadeUp } from "@/lib/motionVariants";
import Image from "next/image";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useExportWallet } from "@privy-io/react-auth/solana";
import { formatNumber } from "@/utils";
import { Spinner } from "@/components/Spinner";
import { useSessionSignature } from "@/hooks/useSessionSignature";
import { useUSDCBalance } from "@/hooks/useUSDCBalance";
import { useSOLBalance } from "@/hooks/useSOLBalance";

const AddFundsModal = lazyLoad(() => import("@/components/AddFundsModal").then(m => ({ default: m.AddFundsModal })), { ssr: false });
const WithdrawModal = lazyLoad(() => import("@/components/WithdrawModal").then(m => ({ default: m.WithdrawModal })), { ssr: false });

interface Activity {
  id: string;
  type: "send" | "request" | "send_claim";
  status: "open" | "settled" | "cancelled";
  amount: number;
  token_address: string;
  message: string | null;
  created_at: string;
  sender_address: string | null;
  receiver_address: string | null;
}

interface Stats {
  sent_direct: number;
  sent_claim: number;
  total_sent: number;
  total_received: number;
  total_requested: number;
  total_claimed: number;
}

interface UserData {
  activities: Activity[];
  stats: Stats;
}

// Status colors
const STATUS_COLORS = {
  open: "#8A6A00",    // darkened from #CB9C00 — achieves 4.6:1 contrast on #fafafa (WCAG AA)
  settled: "#008834",
  cancelled: "#CB0000",
};

type TabType = "wallet" | "activity";

export default function ProfilePage() {
  const { login, logout, authenticated, user } = usePrivy();
  const { exportWallet } = useExportWallet();
  const { address, walletAddress, signature } = useSessionSignature();
  const { balance: usdcBalance, isLoading: usdcLoading } =
    useUSDCBalance(walletAddress);
  const {
    balance: solBalance,
    balanceUSD: solBalanceUSD,
    isLoading: solLoading,
  } = useSOLBalance(walletAddress);

  const [userData, setUserData] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("wallet");
  const [showAddFunds, setShowAddFunds] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [copied, setCopied] = useState(false);

  const isXUser = !!user?.twitter;
  const twitterHandle = user?.twitter?.username;

  useEffect(() => {
    async function fetchUserData() {
      if (!address) return;

      setIsLoading(true);
      try {
        const res = await fetch(`/api/activity/user?address=${address}`);
        if (res.ok) {
          const data = await res.json();
          setUserData(data);
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
      } finally {
        setIsLoading(false);
      }
    }

    if (authenticated && address) {
      fetchUserData();
    }
  }, [authenticated, address]);

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays <= 7) return `${diffDays}d ago`;

    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${date.getDate()} ${months[date.getMonth()]}`;
  };

  const formatAddr = (addr: string) => {
    if (addr.length <= 10) return addr;
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  const handleCopyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const getActivityLabel = (activity: Activity) => {
    const isSender =
      activity.sender_address?.toLowerCase() === address?.toLowerCase();
    switch (activity.type) {
      case "send":
        return isSender
          ? `Sent ${formatNumber(activity.amount)} USDC`
          : `Received ${formatNumber(activity.amount)} USDC`;
      case "send_claim":
        return isSender
          ? `Sent ${formatNumber(activity.amount)} USDC via Claim`
          : `Claimed ${formatNumber(activity.amount)} USDC`;
      case "request":
        if (
          activity.receiver_address?.toLowerCase() === address?.toLowerCase()
        ) {
          return `Requested ${formatNumber(activity.amount)} USDC`;
        }
        return `Fulfilled ${formatNumber(activity.amount)} USDC`;
      default:
        return `${formatNumber(activity.amount)} USDC`;
    }
  };

  const getActivityIcon = (activity: Activity) => {
    const isSender =
      activity.sender_address?.toLowerCase() === address?.toLowerCase();
    if (activity.type === "send" || activity.type === "send_claim") {
      return isSender ? "/assets/send.svg" : "/assets/receive.svg";
    }
    if (activity.type === "request") {
      if (activity.receiver_address?.toLowerCase() === address?.toLowerCase()) {
        return "/assets/receive.svg";
      }
      return "/assets/send.svg";
    }
    return "/assets/send.svg";
  };

  const getActivityLink = (activity: Activity): string | null => {
    if (activity.status !== "open") return null;
    if (activity.type === "request") return `/r/${activity.id}`;
    if (activity.type === "send_claim") return `/c/${activity.id}`;
    return null;
  };

  const ActivityItem = ({ activity }: { activity: Activity }) => {
    const link = getActivityLink(activity);
    const content = (
      <>
        <Image
          src={getActivityIcon(activity)}
          alt=""
          width={20}
          height={20}
          className="mt-0.5 invert"
        />
        <div className="flex-1 min-w-0">
          <p className="text-[#121212] text-sm">{getActivityLabel(activity)}</p>
          <p
            className="text-xs font-normal uppercase"
            style={{ color: STATUS_COLORS[activity.status] }}
          >
            {activity.status}
          </p>
        </div>
        <span className="text-[#121212]/50 text-xs whitespace-nowrap">
          {formatTimeAgo(activity.created_at)}
        </span>
      </>
    );

    if (link) {
      return (
        <Link
          href={link}
          className="flex items-start gap-3 hover:bg-[#121212]/5 -mx-2 px-2 py-1 rounded-lg transition-colors"
        >
          {content}
        </Link>
      );
    }

    return <div className="flex items-start gap-3 py-1">{content}</div>;
  };

  // Not connected state
  if (!authenticated) {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <motion.button
          onClick={login}
          whileTap={{ scale: 0.98 }}
          className="px-8 h-10 bg-[#121212] rounded-full flex items-center justify-center text-[#fafafa] font-semibold shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
        >
          Connect Wallet
        </motion.button>
      </main>
    );
  }

  // Loading state
  if (isLoading && !userData) {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <Spinner size={48} color="#121212" />
        <p className="mt-4 text-[#121212]/70">Loading profile...</p>
      </main>
    );
  }

  const totalUSD = (usdcBalance || 0) + (solBalanceUSD || 0);
  const allActivities = userData?.activities || [];

  return (
    <>
      <main className="flex flex-col items-center p-4 w-full">
        {/* Header: Address + X handle */}
        <div className="w-full max-w-[320px] mb-6">
          <div className="flex items-center justify-between gap-2 w-full">
            <span className="text-[#121212] font-medium text-lg">
              {address ? formatAddr(address) : ""}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={copied ? undefined : handleCopyAddress}
                className={`p-1 rounded-full transition-colors ${copied ? "pointer-events-none" : "hover:bg-[#121212]/5"}`}
              >
                <Image
                  src={
                    copied ? "/assets/success-alt.svg" : "/assets/copy-icon.svg"
                  }
                  alt=""
                  width={copied ? 16 : 16}
                  height={copied ? 8 : 16}
                />
              </button>
              <button
                onClick={logout}
                className="p-1 hover:bg-[#121212]/5 rounded-full transition-colors"
              >
                <Image
                  src="/assets/logout-icon.svg"
                  alt="Logout"
                  width={16}
                  height={16}
                />
              </button>
            </div>
          </div>
          {isXUser && twitterHandle && (
            <div className="flex items-center gap-1.5 mt-1">
              <Image src="/assets/x-icon.svg" alt="X" width={14} height={14} />
              <a
                className="text-[#121212]/60 text-sm decoration-dashed underline underline-offset-4"
                href={`https://x.com/${twitterHandle}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                @{twitterHandle}
              </a>
            </div>
          )}
        </div>

        {/* Tab Toggle */}
        <div className="w-full max-w-[320px] flex mb-6 bg-[#121212]/5 rounded-full p-1 relative">
          {(["wallet", "activity"] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="relative flex-1 h-8 rounded-full text-sm font-medium z-10"
            >
              {activeTab === tab && (
                <motion.div
                  layoutId="profile-tab-bg"
                  className="absolute inset-0 bg-[#121212] rounded-full"
                  transition={{ type: "spring", damping: 28, stiffness: 350 }}
                />
              )}
              <span
                className="relative z-10 transition-colors duration-150"
                style={{ color: activeTab === tab ? "#fafafa" : "rgba(18,18,18,0.5)" }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </span>
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === "wallet" && (
            <motion.div
              key="wallet"
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="w-full max-w-[320px]"
            >
              {/* Total Balance */}
              <div className="text-center mb-6">
                <p className="text-[#121212]/50 text-sm mb-1">Total Balance</p>
                {usdcLoading || solLoading ? (
                  <div className="skeleton h-10 w-32 mx-auto" />
                ) : (
                  <p className="text-4xl font-normal text-[#121212]">
                    {`$${formatNumber(totalUSD)}`}
                  </p>
                )}
              </div>

              {/* Token Rows */}
              <div className="space-y-3 mb-6">
                {/* USDC */}
                <div className="flex items-center gap-3">
                  <Image
                    src="/assets/usdc-icon.svg"
                    alt="USDC"
                    width={32}
                    height={32}
                  />
                  <div className="flex-1">
                    <p className="text-[#121212] font-medium">USDC</p>
                    <p className="text-[#121212]/50 text-sm">
                      {usdcLoading ? (
                        <span className="skeleton h-3.5 w-20 inline-block" />
                      ) : (
                        `${formatNumber(usdcBalance || 0)} USDC`
                      )}
                    </p>
                  </div>
                  <p className="text-[#121212] font-medium">
                    {usdcLoading ? (
                      <span className="skeleton h-4 w-14 inline-block" />
                    ) : (
                      `$${formatNumber(usdcBalance || 0)}`
                    )}
                  </p>
                </div>

                {/* SOL */}
                <div className="flex items-center gap-3">
                  <Image
                    src="/assets/sol-icon.svg"
                    alt="SOL"
                    width={32}
                    height={32}
                  />
                  <div className="flex-1">
                    <p className="text-[#121212] font-medium">SOL</p>
                    <p className="text-[#121212]/50 text-sm">
                      {solLoading ? (
                        <span className="skeleton h-3.5 w-20 inline-block" />
                      ) : (
                        `${(solBalance || 0).toFixed(4)} SOL`
                      )}
                    </p>
                  </div>
                  <p className="text-[#121212] font-medium">
                    {solLoading ? (
                      <span className="skeleton h-4 w-14 inline-block" />
                    ) : (
                      `$${formatNumber(solBalanceUSD || 0)}`
                    )}
                  </p>
                </div>
              </div>

              {/* Stats */}
              <div className="space-y-2 mb-6 border-t border-[#121212]/10 pt-4">
                <div className="flex justify-between">
                  <span className="text-[#121212] text-sm font-medium">
                    Sent
                  </span>
                  <span className="text-[#121212] text-sm font-medium">
                    {formatNumber(userData?.stats?.total_sent || 0)} USDC
                  </span>
                </div>
                <div className="flex justify-between pl-3">
                  <span className="text-[#121212]/50 text-xs">Direct</span>
                  <span className="text-[#121212]/50 text-xs">
                    {formatNumber(userData?.stats?.sent_direct || 0)} USDC
                  </span>
                </div>
                <div className="flex justify-between pl-3">
                  <span className="text-[#121212]/50 text-xs">Via Claim</span>
                  <span className="text-[#121212]/50 text-xs">
                    {formatNumber(userData?.stats?.sent_claim || 0)} USDC
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#121212] text-sm font-medium">
                    Received
                  </span>
                  <span className="text-[#121212] text-sm font-medium">
                    {formatNumber(userData?.stats?.total_received || 0)} USDC
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#121212] text-sm font-medium">
                    Requested
                  </span>
                  <span className="text-[#121212] text-sm font-medium">
                    {formatNumber(userData?.stats?.total_requested || 0)} USDC
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#121212] text-sm font-medium">
                    Claimed
                  </span>
                  <span className="text-[#121212] text-sm font-medium">
                    {formatNumber(userData?.stats?.total_claimed || 0)} USDC
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <motion.button
                  onClick={() => setShowAddFunds(true)}
                  whileTap={{ scale: 0.98 }}
                  className="flex-1 h-10 bg-[#121212] rounded-full flex items-center justify-center text-[#fafafa] font-semibold shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
                >
                  Deposit
                </motion.button>
                <motion.button
                  onClick={() => setShowWithdraw(true)}
                  whileTap={{ scale: 0.98 }}
                  className="flex-1 h-10 bg-[#121212] rounded-full flex items-center justify-center text-[#fafafa] font-semibold shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
                >
                  Withdraw
                </motion.button>
                {isXUser && (
                  <motion.button
                    onClick={() => exportWallet({ address: address || "" })}
                    whileTap={{ scale: 0.98 }}
                    className="flex-1 h-10 border border-[#121212]/20 rounded-full flex items-center justify-center text-[#121212] font-semibold hover:bg-[#121212]/5 transition-colors shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
                  >
                    Export
                  </motion.button>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === "activity" && (
            <motion.div
              key="activity"
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="w-full max-w-[320px] h-111.25 overflow-y-auto overflow-x-hidden"
            >
              {allActivities.length === 0 ? (
                <p className="text-[#121212]/50 text-sm text-center py-8">
                  No activity yet
                </p>
              ) : (
                <motion.div
                  variants={staggerContainer}
                  initial="hidden"
                  animate="visible"
                  className="space-y-2"
                >
                  {allActivities.map((activity) => (
                    <motion.div key={activity.id} variants={staggerItem}>
                      <ActivityItem activity={activity} />
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Add Funds Modal */}
      {showAddFunds && address && (
        <AddFundsModal
          isOpen={showAddFunds}
          onClose={() => setShowAddFunds(false)}
          walletAddress={address}
        />
      )}

      {/* Withdraw Modal */}
      {showWithdraw && address && (
        <WithdrawModal
          isOpen={showWithdraw}
          onClose={() => setShowWithdraw(false)}
          usdcBalance={usdcBalance || 0}
          signature={signature}
          senderPublicKey={address}
        />
      )}
    </>
  );
}
