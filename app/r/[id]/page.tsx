"use client";

import { useEffect, useState, use } from "react";
import { motion } from "motion/react";
import Image from "next/image";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import { formatNumber } from "@/utils";
import { Spinner } from "@/components";
import { useSessionSignature } from "@/hooks/useSessionSignature";
import { useFee } from "@/hooks/useFee";

interface RequestData {
  id: string;
  amount: number;
  token: string;
  status: string;
  message: string | null;
  createdAt: string;
  receiverAddress?: string;
}

type PageState =
  | "loading"
  | "ready"
  | "processing"
  | "success"
  | "error"
  | "not_found"
  | "already_paid"
  | "cancelled"
  | "cancelling";

export default function RequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { login, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { walletAddress, getSignature } = useSessionSignature();
  const { baseFee, feePercent } = useFee();
  const [requestData, setRequestData] = useState<RequestData | null>(null);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const solanaWallet = wallets[0];

  useEffect(() => {
    async function fetchRequestData() {
      try {
        const res = await fetch(`/api/request/${id}`);

        if (res.status === 404) {
          setPageState("not_found");
          return;
        }

        if (!res.ok) {
          throw new Error("Failed to fetch request data");
        }

        const data: RequestData = await res.json();
        setRequestData(data);

        if (data.status === "settled") {
          setPageState("already_paid");
        } else if (data.status === "cancelled") {
          setPageState("cancelled");
        } else {
          setPageState("ready");
        }
      } catch (error) {
        console.error("Error fetching request:", error);
        setPageState("error");
      }
    }

    fetchRequestData();
  }, [id]);

  const handlePay = async () => {
    if (!authenticated) {
      login();
      return;
    }

    if (!requestData?.receiverAddress) {
      return;
    }

    const session = await getSignature();
    if (!session) {
      setErrorMessage("Signature required to continue");
      setPageState("error");
      return;
    }

    setPageState("processing");
    setErrorMessage(null);

    try {
      // Step 1: Prepare the transaction
      const prepareRes = await fetch("/api/request/fulfill/prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Signature": session.signature,
        },
        body: JSON.stringify({
          activityId: id,
          payerPublicKey: session.address,
        }),
      });

      if (!prepareRes.ok) {
        const errorData = await prepareRes.json();
        throw new Error(errorData.error || "Failed to prepare transaction");
      }

      const prepareResult = await prepareRes.json();

      // Step 2: Sign the transaction
      const depositTxBytes = Uint8Array.from(
        atob(prepareResult.unsignedDepositTx),
        (c) => c.charCodeAt(0),
      );

      const signedDepositResult = await solanaWallet.signTransaction({
        transaction: depositTxBytes,
      });

      const signedDepositTx = btoa(
        String.fromCharCode.apply(
          null,
          Array.from(signedDepositResult.signedTransaction),
        ),
      );

      // Step 3: Submit the transaction
      const submitRes = await fetch("/api/request/fulfill/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Signature": session.signature,
        },
        body: JSON.stringify({
          signedDepositTx,
          activityId: prepareResult.activityId,
          payerPublicKey: session.address,
          lastValidBlockHeight: prepareResult.lastValidBlockHeight,
        }),
      });

      if (!submitRes.ok) {
        const errorData = await submitRes.json();
        throw new Error(errorData.error || "Failed to submit transaction");
      }

      setPageState("success");
    } catch (error: any) {
      console.error("Pay request failed:", error);
      setErrorMessage(error.message || "Something went wrong");
      setPageState("error");
    }
  };

  const formatAddress = (addr: string) => {
    if (addr.length <= 10) return addr;
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  // Check if current user is the requestor (owner of this request)
  const isRequestor =
    authenticated &&
    walletAddress &&
    requestData?.receiverAddress &&
    walletAddress.toLowerCase() === requestData.receiverAddress.toLowerCase();

  const handleCancel = async () => {
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

    setPageState("cancelling");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/request/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Signature": session.signature,
        },
        body: JSON.stringify({
          activityId: id,
          requesterAddress: session.address,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to cancel request");
      }

      setPageState("cancelled");
    } catch (error: any) {
      console.error("Cancel request failed:", error);
      setErrorMessage(error.message || "Something went wrong");
      setPageState("error");
    }
  };

  if (pageState === "loading") {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <Spinner size={48} color="#121212" />
        <p className="mt-4 text-[#121212]/70">Loading request...</p>
      </main>
    );
  }

  if (pageState === "not_found") {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <span className="text-red-500 text-2xl">!</span>
        </div>
        <p className="text-[#121212] font-medium">Request not found</p>
        <p className="text-[#121212]/60 text-sm mt-2">
          This link may be invalid or expired.
        </p>
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

  if (pageState === "already_paid") {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <div className="w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center mb-4">
          <span className="text-yellow-600 text-2xl">!</span>
        </div>
        <p className="text-[#121212] font-medium">Already paid</p>
        <p className="text-[#121212]/60 text-sm mt-2">
          This request has already been fulfilled.
        </p>
      </main>
    );
  }

  if (pageState === "cancelled") {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <span className="text-[#CB0000] text-2xl">!</span>
        </div>
        <p className="text-[#121212] font-medium">Request Cancelled</p>
        <p className="text-[#121212]/60 text-sm mt-2">
          This payment request has been cancelled.
        </p>
      </main>
    );
  }

  if (pageState === "processing" || pageState === "cancelling") {
    return (
      <main className="flex flex-col items-center justify-center p-4 w-full min-h-[60vh]">
        <Spinner size={48} color="#121212" />
        <p className="mt-4 text-[#121212]/70">{pageState === "cancelling" ? "Cancelling request..." : "Processing payment..."}</p>
      </main>
    );
  }

  if (!requestData) return null;

  const partnerFee = baseFee + requestData.amount * feePercent;
  const requestorReceives = requestData.amount - partnerFee;

  return (
    <main className="flex flex-col items-center p-4 w-full">
      {/* Amount Display */}
      <div className="flex flex-col items-center mb-8 w-full max-w-full">
        <div className="w-full max-w-[320px] overflow-x-auto scrollbar-hide">
          <p className="text-6xl font-light text-[#121212] text-center">
            ${formatNumber(requestData.amount)}
          </p>
        </div>
        {requestData.message && (
          <p className="mt-2 text-[#121212]/50 text-sm">
            {requestData.message}
          </p>
        )}
      </div>

      {/* Details */}
      <div className="w-full max-w-[320px] space-y-2 mb-8">
        {requestData.receiverAddress ? (
          <div className="flex justify-between">
            <span className="text-[#121212]">Requested by</span>
            <span className="text-[#121212]">
              {formatAddress(requestData.receiverAddress)}
            </span>
          </div>
        ) : null}
        <div className="flex justify-between">
          <span className="text-[#121212]">Partner fees</span>
          <span className="text-[#121212]">
            ~{formatNumber(partnerFee)} USDC
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#121212]">{isRequestor ? "You receive" : "They receive"}</span>
          <span className="text-[#121212]">
            ~{formatNumber(requestorReceives)} USDC
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#121212] font-semibold">Total</span>
          <span className="text-[#121212] font-semibold">
            {formatNumber(requestData.amount)} USDC
          </span>
        </div>
      </div>

      {/* Pay Button (for payers) or Cancel Button (for requestor) */}
      {pageState === "ready" && !isRequestor && (
        <motion.button
          onClick={handlePay}
          whileTap={{ scale: 0.98 }}
          className="w-full max-w-[320px] h-12 bg-[#121212] rounded-full flex items-center justify-center shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
        >
          <Image src="/assets/send.svg" alt="Pay" width={24} height={24} />
        </motion.button>
      )}

      {/* Cancel Button (for requestor only) */}
      {pageState === "ready" && isRequestor && (
        <motion.button
          onClick={handleCancel}
          whileTap={{ scale: 0.98 }}
          className="w-full max-w-[320px] h-12 bg-[#fafafa] border border-[#CB0000] rounded-full flex items-center justify-center text-[#CB0000] font-semibold shadow-[0_2px_8px_rgba(203,0,0,0.1)]"
        >
          Cancel Request
        </motion.button>
      )}

      {/* Success State */}
      {pageState === "success" && (
        <motion.button
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-full max-w-[320px] h-12 bg-[#fafafa] border border-[#121212]/70 rounded-full flex items-center justify-center shadow-[0_4px_12px_rgba(18,18,18,0.15)]"
        >
          <Image
            src="/assets/success-alt.svg"
            alt="Success"
            width={24}
            height={24}
          />
        </motion.button>
      )}
    </main>
  );
}
