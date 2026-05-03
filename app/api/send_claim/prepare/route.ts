import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

import { TokenType } from "@/lib/privacycash/tokens";
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
      senderPublicKey,
      amount,
      token,
      message,
      providerId: providerIdInput,
    }: {
      senderPublicKey: string;
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

    // Validation
    if (!senderPublicKey || !amount || !token) {
      return NextResponse.json(
        { error: "Missing required fields: senderPublicKey, amount, token" },
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
    // PC uses its own message text (PC SDK requires it for UTXO encryption);
    // MB and Umbra use their own messages so the wallet popup matches the
    // protocol the user picked.
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
    const result = await provider.prepareSendClaim({
      connection,
      senderPublicKey: senderPubKey,
      sessionSignature: sessionSigBytes,
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
    console.error("Prepare claim link error:", error);

    return NextResponse.json(
      { error: error.message ?? "Failed to prepare claim link" },
      { status: 500 }
    );
  }
}
