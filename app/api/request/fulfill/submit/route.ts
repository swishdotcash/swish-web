import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

import {
  DEFAULT_PROVIDER_ID,
  getProvider,
  isProviderId,
  type ProviderId,
} from "@/lib/providers";
import { getSessionMessageForProvider } from "@/lib/session-messages";

export async function POST(request: NextRequest) {
  try {
    // Get session signature from header
    const sessionSignature = request.headers.get("X-Session-Signature");
    if (!sessionSignature) {
      return NextResponse.json(
        { error: "Missing X-Session-Signature header" },
        { status: 401 }
      );
    }

    const sessionSigBytes = Buffer.from(sessionSignature, "base64");
    if (sessionSigBytes.length !== 64) {
      return NextResponse.json(
        { error: "Session signature must be 64 bytes" },
        { status: 401 }
      );
    }

    const body = await request.json();

    const {
      signedDepositTx,
      activityId,
      payerPublicKey,
      lastValidBlockHeight,
      providerId: providerIdInput,
      providerContext,
    }: {
      signedDepositTx: string;
      activityId: string;
      payerPublicKey: string;
      lastValidBlockHeight?: number;
      providerId?: string;
      providerContext?: Record<string, unknown>;
    } = body;

    let providerId: ProviderId = DEFAULT_PROVIDER_ID;
    if (providerIdInput) {
      if (!isProviderId(providerIdInput)) {
        return NextResponse.json(
          { error: `Unknown providerId: ${providerIdInput}` },
          { status: 400 }
        );
      }
      providerId = providerIdInput;
    }

    // Validation
    if (!signedDepositTx || !activityId || !payerPublicKey) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Parse inputs
    const payerPubKey = new PublicKey(payerPublicKey);

    // Verify session signature against the protocol-matching message.
    const sessionMessage = getSessionMessageForProvider(providerId);
    const messageBytes = Buffer.from(sessionMessage);
    const isValid = nacl.sign.detached.verify(
      messageBytes,
      sessionSigBytes,
      payerPubKey.toBytes()
    );

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid session signature for payer address" },
        { status: 401 }
      );
    }

    // Get connection
    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json(
        { error: "RPC_URL not configured" },
        { status: 500 }
      );
    }
    const connection = new Connection(rpcUrl, "confirmed");

    // Execute submit via provider - user already signed and paid their own gas
    const provider = getProvider(providerId);
    const result = await provider.submitFulfill({
      connection,
      signedDepositTx,
      sessionSignature: sessionSigBytes,
      activityId,
      payerPublicKey: payerPubKey,
      lastValidBlockHeight,
      providerContext,
    });

    return NextResponse.json({ ...result, providerId });
  } catch (error: any) {
    console.error("Submit fulfill error:", error);

    if (error.message === "Request not found") {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (error.message === "Request already fulfilled or cancelled") {
      return NextResponse.json(
        { error: "Request already fulfilled or cancelled" },
        { status: 410 }
      );
    }

    if (error.message === "Transaction expired. Please prepare again.") {
      return NextResponse.json(
        { error: "Transaction expired. Please prepare again." },
        { status: 408 } // Request Timeout
      );
    }

    return NextResponse.json(
      { error: error.message ?? "Failed to submit fulfill" },
      { status: 500 }
    );
  }
}
