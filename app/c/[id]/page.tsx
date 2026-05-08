"use client";

import { useEffect, useState, use } from "react";
import { motion } from "motion/react";
import Image from "next/image";
import { usePrivy } from "@privy-io/react-auth";
import { formatNumber } from "@/utils";
import {
  Spinner,
  ClaimPassphraseModal,
  ProtocolBadge,
  WalletStatus,
} from "@/components";
import { useSessionSignature } from "@/hooks/useSessionSignature";
import { useProtocolFee } from "@/hooks/useProtocolFee";
import {
  DEFAULT_PROVIDER_ID,
  isProviderId,
  type ProviderId,
} from "@/lib/providers/types";

interface ClaimData {
  id: string;
  amount: number;
  token: string;
  status: string;
  message: string | null;
  createdAt: string;
  isSender: boolean;
  providerId: string | null;
}

type PageState = "loading" | "ready" | "success" | "error" | "not_found" | "already_claimed" | "reclaiming" | "reclaimed";

export default function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { login, authenticated, ready } = usePrivy();
  const [claimData, setClaimData] = useState<ClaimData | null>(null);

  // Pick the session-sig hook variant matching the row's provider so the
  // wallet popup shows the protocol-matching message text. Defaults to PC
  // until claim data loads.
  const reclaimProvider: ProviderId =
    claimData?.providerId && isProviderId(claimData.providerId)
      ? (claimData.providerId as ProviderId)
      : DEFAULT_PROVIDER_ID;
  const { walletAddress, getSignature } = useSessionSignature(reclaimProvider);
  // Fee shown reflects the row's actual protocol — PC has its dynamic base
  // + 0.35%, MB charges only gas, Umbra is 0.7% on claim. Hook is called
  // unconditionally (claimData=null → amount=0, value isn't rendered yet).
  const { feeUSDC: partnerFee } = useProtocolFee(
    reclaimProvider,
    claimData?.amount ?? 0,
    "send_claim"
  );
  const [pageState, setPageState] = useState<PageState>("loading");
  const [showPassphraseModal, setShowPassphraseModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Wait for Privy to finish hydrating before any fetch — otherwise an
    // unauthenticated-looking first render fires a no-wallet fetch that
    // can race-overwrite the correct one when wallet eventually loads.
    if (!ready) return;
    // Then, if authenticated, wait for walletAddress so isSender is reliable.
    if (authenticated && !walletAddress) return;

    async function fetchClaimData() {
      try {
        const url = walletAddress
          ? `/api/send_claim/${id}?wallet=${walletAddress}`
          : `/api/send_claim/${id}`;

        const res = await fetch(url);

        if (res.status === 404) {
          setPageState("not_found");
          return;
        }

        if (!res.ok) {
          throw new Error("Failed to fetch claim data");
        }

        const data: ClaimData = await res.json();
        setClaimData(data);

        if (data.status === "settled" || data.status === "cancelled") {
          setPageState("already_claimed");
        } else {
          setPageState("ready");
        }
      } catch (error) {
        console.error("Error fetching claim:", error);
        setPageState("error");
      }
    }

    fetchClaimData();
  }, [id, walletAddress, authenticated, ready]);

  const handleClaim = () => {
    if (!authenticated) {
      login();
      return;
    }
    if (!walletAddress) {
      return;
    }
    setShowPassphraseModal(true);
  };

  const handleClaimSuccess = () => {
    setPageState("success");
  };

  const handleReclaim = async () => {
    if (!authenticated) {
      login();
      return;
    }

    const session = await getSignature();
    if (!session) {
      setErrorMessage("Signature required to continue");
      setPageState("error");
      return;
    }

    setPageState("reclaiming");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/send_claim/reclaim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Signature": session.signature,
        },
        body: JSON.stringify({
          activityId: id,
          senderPublicKey: session.address,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to reclaim");
      }

      setPageState("reclaimed");
    } catch (error: any) {
      console.error("Reclaim failed:", error);
      setErrorMessage(error.message || "Something went wrong");
      setPageState("error");
    }
  };

  if (pageState === "loading") {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <Spinner size={48} color="#121212" />
        <p className="mt-4 text-[#121212]/70">Loading claim...</p>
      </main>
    );
  }

  if (pageState === "not_found") {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <span className="text-red-500 text-2xl">!</span>
        </div>
        <p className="text-[#121212] font-medium">Claim link not found</p>
        <p className="text-[#121212]/60 text-sm mt-2">This link may be invalid or expired.</p>
      </main>
    );
  }

  if (pageState === "error") {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <span className="text-red-500 text-2xl">!</span>
        </div>
        <p className="text-[#121212] font-medium">Something went wrong</p>
        <p className="text-[#121212]/60 text-sm mt-2">
          {errorMessage || "Please try again later."}
        </p>
        <motion.button
          onClick={() => setPageState("ready")}
          whileTap={{ scale: 0.98 }}
          className="mt-4 px-6 h-10 bg-[#121212] rounded-full text-[#fafafa] font-semibold"
        >
          Try Again
        </motion.button>
      </main>
    );
  }

  if (pageState === "reclaiming") {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <Spinner size={48} color="#121212" />
        <p className="mt-4 text-[#121212]/70">Reclaiming funds...</p>
      </main>
    );
  }

  if (pageState === "reclaimed") {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
          <Image src="/assets/success-alt.svg" alt="Success" width={24} height={24} />
        </div>
        <p className="text-[#121212] font-medium">Funds Reclaimed</p>
        <p className="text-[#121212]/60 text-sm mt-2">
          The funds have been returned to your wallet.
        </p>
      </main>
    );
  }

  if (pageState === "already_claimed") {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <div className="w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center mb-4">
          <span className="text-yellow-600 text-2xl">!</span>
        </div>
        <p className="text-[#121212] font-medium">Already claimed</p>
        <p className="text-[#121212]/60 text-sm mt-2">This claim link has already been used.</p>
      </main>
    );
  }

  if (!claimData) return null;

  const youReceive = claimData.amount - partnerFee;

  const senderProviderId =
    claimData.providerId && isProviderId(claimData.providerId)
      ? (claimData.providerId as ProviderId)
      : null;

  return (
    <>
      <main className="flex flex-col items-center p-4 w-full">
        {/* Amount Display */}
        <div className="flex flex-col items-center mb-6 w-full max-w-full">
          <div className="w-full max-w-[320px] overflow-x-auto scrollbar-hide">
            <p className="text-6xl font-light text-[#121212] text-center">
              ${formatNumber(claimData.amount)}
            </p>
          </div>
          {claimData.message && (
            <p className="mt-2 text-[#121212]/50 text-sm">
              {claimData.message}
            </p>
          )}
        </div>

        <div className="w-full flex justify-center mb-6">
          <WalletStatus />
        </div>

        {/* Details */}
        <div className="w-full max-w-[320px] space-y-2 mb-8">
          {senderProviderId && (
            <div className="flex justify-between">
              <span className="text-[#121212]">Sent via</span>
              <ProtocolBadge providerId={senderProviderId} />
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-[#121212]">Partner fees</span>
            <span className="text-[#121212]">~{formatNumber(partnerFee)} USDC</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#121212]">{claimData?.isSender ? "You get back" : "You receive"}</span>
            <span className="text-[#121212]">~{formatNumber(youReceive)} USDC</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#121212] font-semibold">Total</span>
            <span className="text-[#121212] font-semibold">{formatNumber(claimData.amount)} USDC</span>
          </div>
        </div>

        {/* Claim Button (for receivers) */}
        {pageState === "ready" && (!authenticated || !claimData?.isSender) && (
          <motion.button
            onClick={handleClaim}
            whileTap={{ scale: 0.98 }}
            className="w-full max-w-[320px] h-12 bg-[#121212] rounded-full flex items-center justify-center text-[#fafafa] font-semibold shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
          >
            Claim
          </motion.button>
        )}

        {/* Reclaim Button (for sender only) */}
        {pageState === "ready" && authenticated && claimData?.isSender && (
          <motion.button
            onClick={handleReclaim}
            whileTap={{ scale: 0.98 }}
            className="w-full max-w-[320px] h-12 bg-[#fafafa] border border-[#CB0000] rounded-full flex items-center justify-center text-[#CB0000] font-semibold shadow-[0_2px_8px_rgba(203,0,0,0.1)]"
          >
            Reclaim
          </motion.button>
        )}

        {/* Success State */}
        {pageState === "success" && (
          <motion.button
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-[320px] h-12 bg-[#fafafa] border border-[#121212]/70 rounded-full flex items-center justify-center shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
          >
            <Image src="/assets/success-alt.svg" alt="Success" width={24} height={24} />
          </motion.button>
        )}
      </main>

      {/* Passphrase Modal */}
      {showPassphraseModal && claimData && walletAddress && (
        <ClaimPassphraseModal
          isOpen={showPassphraseModal}
          onClose={() => setShowPassphraseModal(false)}
          amount={claimData.amount}
          activityId={claimData.id}
          receiverAddress={walletAddress}
          providerId={reclaimProvider}
          onSuccess={handleClaimSuccess}
        />
      )}
    </>
  );
}
