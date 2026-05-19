import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

import { TokenType } from "@/lib/privacycash/tokens";
import {
  DEFAULT_PROVIDER_ID,
  getProvider,
  isProviderDisabled,
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
      senderPublicKey,
      receiverAddress,
      amount,
      token,
      message,
      providerId: providerIdInput,
    }: {
      senderPublicKey: string;
      receiverAddress: string;
      amount: number;
      token: TokenType;
      message?: string;
      providerId?: string;
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

    if (isProviderDisabled(providerId)) {
      return NextResponse.json(
        { error: `Provider ${providerId} is temporarily unavailable (maintenance)` },
        { status: 503 }
      );
    }

    // Validation
    if (!senderPublicKey || !receiverAddress || !amount || !token) {
      return NextResponse.json(
        { error: "Missing required fields: senderPublicKey, receiverAddress, amount, token" },
        { status: 400 }
      );
    }

    if (amount <= 0) {
      return NextResponse.json(
        { error: "Amount must be greater than zero" },
        { status: 400 }
      );
    }

    // Parse inputs
    const senderPubKey = new PublicKey(senderPublicKey);

    // Verify session signature against the protocol-matching message.
    // Each protocol has its own session message; we validate against the
    // one matching the provider being dispatched.
    const sessionMessage = getSessionMessageForProvider(providerId);
    const messageBytes = Buffer.from(sessionMessage);
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

    // Execute prepare via provider - user pays their own gas fees
    const provider = getProvider(providerId);
    const result = await provider.prepare({
      connection,
      senderPublicKey: senderPubKey,
      sessionSignature: sessionSigBytes,
      receiverAddress,
      amount,
      token,
      message,
    });

    return NextResponse.json({
      ...result,
      providerId,
      sessionMessage,
    });
  } catch (error: any) {
    console.error("Prepare send error:", error);

    return NextResponse.json(
      { error: error.message ?? "Failed to prepare send" },
      { status: 500 }
    );
  }
}
