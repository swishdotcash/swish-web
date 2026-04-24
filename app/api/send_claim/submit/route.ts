import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

import { SESSION_MESSAGE } from "@/lib/sponsor/prepareAndSubmitSend";
import {
  DEFAULT_PROVIDER_ID,
  getProvider,
  isProviderId,
  type ProviderId,
} from "@/lib/providers";

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
      senderPublicKey,
      lastValidBlockHeight,
      providerId: providerIdInput,
      providerContext,
    }: {
      signedDepositTx: string;
      activityId: string;
      senderPublicKey: string;
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
    if (!signedDepositTx || !activityId || !senderPublicKey) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Parse inputs
    const senderPubKey = new PublicKey(senderPublicKey);

    // Verify session signature proves ownership of senderPublicKey
    const messageBytes = Buffer.from(SESSION_MESSAGE);
    const isValid = nacl.sign.detached.verify(
      messageBytes,
      sessionSigBytes,
      senderPubKey.toBytes()
    );

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid session signature for sender address" },
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
    const result = await provider.submitSendClaim({
      connection,
      signedDepositTx,
      sessionSignature: sessionSigBytes,
      activityId,
      senderPublicKey: senderPubKey,
      lastValidBlockHeight,
      providerContext,
    });

    return NextResponse.json({ ...result, providerId });
  } catch (error: any) {
    console.error("Submit claim link error:", error);

    if (error.message === "Transaction expired. Please prepare again.") {
      return NextResponse.json(
        { error: "Transaction expired. Please prepare again." },
        { status: 408 }
      );
    }

    if (error.message === "Activity not found") {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    if (error.message === "Claim link already processed") {
      return NextResponse.json(
        { error: "Claim link already processed" },
        { status: 410 }
      );
    }

    return NextResponse.json(
      { error: error.message ?? "Failed to submit claim link" },
      { status: 500 }
    );
  }
}
