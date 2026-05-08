"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useExportWallet } from "@privy-io/react-auth/solana";
import { formatNumber } from "@/utils";
import {
  Spinner,
  AddFundsModal,
  WithdrawModal,
  UnlockModal,
  ProtocolBadge,
} from "@/components";
import { isProviderId } from "@/lib/providers/types";
import { useSessionSignature } from "@/hooks/useSessionSignature";
import { useUSDCBalance } from "@/hooks/useUSDCBalance";
import { useSOLBalance } from "@/hooks/useSOLBalance";
import { useUmbraStatus } from "@/hooks/useUmbraStatus";
import { useUmbraRegister } from "@/hooks/useUmbraRegister";
import { useUmbraBalance } from "@/hooks/useUmbraBalance";

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
  provider_id: string | null;
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
  open: "#CB9C00",
  settled: "#008834",
  cancelled: "#CB0000",
};

type TabType = "wallet" | "activity";

export default function ProfilePage() {
  const { login, logout, authenticated, user } = usePrivy();
  const { exportWallet } = useExportWallet();
  const { walletAddress, getSignature } = useSessionSignature();
  const {
    balance: usdcBalance,
    isLoading: usdcLoading,
    refetch: refetchUSDCBalance,
  } = useUSDCBalance(walletAddress);
  const {
    balance: solBalance,
    balanceUSD: solBalanceUSD,
    isLoading: solLoading,
  } = useSOLBalance(walletAddress);
  const { status: umbraStatus, refetch: refetchUmbraStatus } = useUmbraStatus();
  const { register: registerUmbra, state: umbraRegisterState } = useUmbraRegister();
  const isUmbraRegistered = umbraStatus === "registered";
  const {
    totalUSDC: umbraBalanceUSDC,
    totalBaseUnits: umbraBalanceBaseUnits,
    hasPending: umbraHasPending,
    status: umbraBalanceStatus,
    error: umbraBalanceError,
    refetch: refetchUmbraBalance,
  } = useUmbraBalance(isUmbraRegistered);
  const [showUnlock, setShowUnlock] = useState(false);

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
      if (!walletAddress) return;

      setIsLoading(true);
      try {
        const res = await fetch(`/api/activity/user?address=${walletAddress}`);
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

    if (authenticated && walletAddress) {
      fetchUserData();
    }
  }, [authenticated, walletAddress]);

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
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleRegisterUmbra = async () => {
    try {
      await registerUmbra();
    } catch {
      // hook surfaces error in state
    } finally {
      refetchUmbraStatus();
    }
  };

  const isRegisteringUmbra =
    umbraRegisterState.stage === "checking" ||
    umbraRegisterState.stage === "registering";

  const handleOpenUnlock = () => {
    if (!umbraBalanceBaseUnits || umbraBalanceBaseUnits === BigInt(0)) return;
    setShowUnlock(true);
  };

  const getActivityLabel = (activity: Activity) => {
    const isSender =
      activity.sender_address?.toLowerCase() === walletAddress?.toLowerCase();
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
          activity.receiver_address?.toLowerCase() === walletAddress?.toLowerCase()
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
      activity.sender_address?.toLowerCase() === walletAddress?.toLowerCase();
    if (activity.type === "send" || activity.type === "send_claim") {
      return isSender ? "/assets/send.svg" : "/assets/receive.svg";
    }
    if (activity.type === "request") {
      if (activity.receiver_address?.toLowerCase() === walletAddress?.toLowerCase()) {
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
          <div className="flex items-center gap-1.5">
            <p className="text-[#121212] text-sm">{getActivityLabel(activity)}</p>
            {activity.provider_id && isProviderId(activity.provider_id) && (
              <ProtocolBadge
                providerId={activity.provider_id}
                iconSize={12}
                showLabel={false}
              />
            )}
          </div>
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

  // Total = mainnet USDC + SOL (in USD) + Umbra shielded total (encrypted
  // + filtered claimable, computed in useUmbraBalance). Shielded only
  // contributes once the user has clicked Reveal.
  const totalUSD =
    (usdcBalance || 0) +
    (solBalanceUSD || 0) +
    (umbraBalanceStatus === "ready" ? umbraBalanceUSDC || 0 : 0);
  const allActivities = userData?.activities || [];

  return (
    <>
      <main className="flex flex-col items-center p-4 w-full h-[stretch]">
        {/* Header: Address + X handle */}
        <div className="w-full max-w-[320px] mb-6">
          <div className="flex items-center justify-between gap-2 w-full">
            <span className="text-[#121212] font-medium text-lg">
              {walletAddress ? formatAddr(walletAddress) : ""}
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
        <div className="w-full max-w-[320px] flex mb-6 bg-[#121212]/5 rounded-full p-1">
          <button
            onClick={() => setActiveTab("wallet")}
            className={`flex-1 h-8 rounded-full text-sm font-medium transition-all ${
              activeTab === "wallet"
                ? "bg-[#121212] text-[#fafafa]"
                : "text-[#121212]/50"
            }`}
          >
            Wallet
          </button>
          <button
            onClick={() => setActiveTab("activity")}
            className={`flex-1 h-8 rounded-full text-sm font-medium transition-all ${
              activeTab === "activity"
                ? "bg-[#121212] text-[#fafafa]"
                : "text-[#121212]/50"
            }`}
          >
            Activity
          </button>
        </div>

        <AnimatePresence mode="wait">
          {activeTab === "wallet" && (
            <motion.div
              key="wallet"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full max-w-[320px]"
            >
              {/* Total Balance */}
              <div className="text-center mb-6">
                <p className="text-[#121212]/50 text-sm mb-1">Total Balance</p>
                <p className="text-4xl font-normal text-[#121212]">
                  {usdcLoading || solLoading
                    ? "..."
                    : `$${formatNumber(totalUSD)}`}
                </p>
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
                      {usdcLoading
                        ? "..."
                        : `${formatNumber(usdcBalance || 0)} USDC`}
                    </p>
                  </div>
                  <p className="text-[#121212] font-medium">
                    {usdcLoading ? "..." : `$${formatNumber(usdcBalance || 0)}`}
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
                      {solLoading
                        ? "..."
                        : `${(solBalance || 0).toFixed(4)} SOL`}
                    </p>
                  </div>
                  <p className="text-[#121212] font-medium">
                    {solLoading
                      ? "..."
                      : `$${formatNumber(solBalanceUSD || 0)}`}
                  </p>
                </div>
              </div>

              {/* Umbra section */}
              <div className="mb-6 border-t border-[#121212]/10 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-[#121212] text-sm font-medium">
                      <Image
                        src="/assets/Umbra-Logo-1.png"
                        alt=""
                        width={16}
                        height={16}
                      />
                      <span>Umbra</span>
                    </div>
                    {!isUmbraRegistered && (
                      <p className="text-[#121212]/50 text-xs mt-0.5">
                        Enable to receive private USDC via Umbra
                      </p>
                    )}
                  </div>
                  {isUmbraRegistered ? (
                    <span className="text-xs font-medium text-[#008834] px-2.5 py-1 rounded-full bg-[#008834]/10 whitespace-nowrap">
                      Enabled
                    </span>
                  ) : (
                    <motion.button
                      onClick={handleRegisterUmbra}
                      disabled={
                        isRegisteringUmbra ||
                        umbraStatus === "loading" ||
                        umbraStatus === "no-wallet"
                      }
                      whileTap={{ scale: 0.98 }}
                      className="text-xs font-semibold px-3 h-7 rounded-full bg-[#121212] text-[#fafafa] disabled:opacity-50 whitespace-nowrap"
                    >
                      {isRegisteringUmbra ? "Working…" : "Enable"}
                    </motion.button>
                  )}
                </div>
                {!isUmbraRegistered && !isRegisteringUmbra && (
                  <p className="text-[#121212]/40 text-[11px] mt-2">
                    One-time setup; you&apos;ll sign ~4–5 wallet prompts. Most of the SOL staged is auto-refunded; net cost ~$0.60.
                  </p>
                )}
                {umbraRegisterState.error && (
                  <p className="text-[#CB0000] text-xs mt-2 break-words">
                    {umbraRegisterState.error.split("\n")[0]}
                  </p>
                )}

                {/* Shielded balance + Reveal/Unlock (registered only) */}
                {isUmbraRegistered && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-[#121212]/50 text-xs">
                          Shielded balance
                        </p>
                        <div className="text-[#121212] text-sm font-medium h-5 flex items-center">
                          {umbraBalanceStatus === "needs-reveal" ? (
                            "Hidden"
                          ) : umbraBalanceStatus === "loading" ? (
                            <Spinner size={14} color="#121212" />
                          ) : umbraBalanceStatus === "error" ? (
                            "—"
                          ) : (
                            `${formatNumber(umbraBalanceUSDC || 0)} USDC`
                          )}
                        </div>
                      </div>
                      {umbraBalanceStatus === "needs-reveal" ||
                      umbraBalanceStatus === "loading" ? (
                        <motion.button
                          onClick={async () => {
                            await refetchUmbraBalance();
                            refetchUSDCBalance();
                          }}
                          disabled={umbraBalanceStatus === "loading"}
                          whileTap={{ scale: 0.98 }}
                          className="text-xs font-semibold px-3 h-7 rounded-full bg-[#121212] text-[#fafafa] disabled:opacity-50 whitespace-nowrap"
                        >
                          {umbraBalanceStatus === "loading"
                            ? "Revealing…"
                            : "Reveal"}
                        </motion.button>
                      ) : (
                        <motion.button
                          onClick={handleOpenUnlock}
                          disabled={
                            !umbraBalanceBaseUnits ||
                            umbraBalanceBaseUnits === BigInt(0)
                          }
                          whileTap={{ scale: 0.98 }}
                          className="text-xs font-semibold px-3 h-7 rounded-full bg-[#121212] text-[#fafafa] disabled:opacity-30 whitespace-nowrap"
                        >
                          Unlock
                        </motion.button>
                      )}
                    </div>
                    {umbraBalanceStatus === "needs-reveal" && (
                      <p className="text-[#121212]/40 text-[11px] mt-2">
                        Tap Reveal to view your shielded balance (one signature).
                      </p>
                    )}
                    {umbraBalanceStatus === "error" && umbraBalanceError && (
                      <p className="text-[#CB0000] text-xs mt-2 break-words">
                        Balance fetch failed: {umbraBalanceError.split("\n")[0]}
                      </p>
                    )}
                  </div>
                )}
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
                    onClick={() => exportWallet({ address: walletAddress || "" })}
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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full max-w-[320px] h-111.25 overflow-y-auto overflow-x-hidden"
            >
              {allActivities.length === 0 ? (
                <p className="text-[#121212]/50 text-sm text-center py-8">
                  No activity yet
                </p>
              ) : (
                <div className="space-y-2">
                  {allActivities.map((activity) => (
                    <ActivityItem key={activity.id} activity={activity} />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Add Funds Modal */}
      {showAddFunds && walletAddress && (
        <AddFundsModal
          isOpen={showAddFunds}
          onClose={() => setShowAddFunds(false)}
          walletAddress={walletAddress}
        />
      )}

      {/* Withdraw Modal */}
      {showWithdraw && walletAddress && (
        <WithdrawModal
          isOpen={showWithdraw}
          onClose={() => setShowWithdraw(false)}
          usdcBalance={usdcBalance || 0}
          getSignature={getSignature}
        />
      )}

      {/* Unlock Modal — Umbra shielded → mainnet ATA. Modal shows the
          combined balance (encrypted + filtered claimable); the unlock
          flow does claim+settle+withdraw if there's anything to claim. */}
      {showUnlock && (
        <UnlockModal
          isOpen={showUnlock}
          onClose={() => {
            setShowUnlock(false);
            refetchUmbraBalance();
            refetchUSDCBalance();
          }}
          availableUSDC={umbraBalanceUSDC || 0}
          availableBaseUnits={umbraBalanceBaseUnits || BigInt(0)}
          hasPending={umbraHasPending}
          onSuccess={() => {
            refetchUmbraBalance();
            refetchUSDCBalance();
          }}
        />
      )}
    </>
  );
}
