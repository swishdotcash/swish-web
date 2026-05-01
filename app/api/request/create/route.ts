import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

import { createRequest } from "@/lib/operations/request";
import { TokenType } from "@/lib/privacycash/tokens";
import { REQUEST_SESSION_MESSAGE } from "@/lib/session-messages";

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
      requesterAddress,
      payerAddress,
      amount,
      token,
      message,
    }: {
      requesterAddress: string;
      payerAddress?: string;
      amount: number;
      token: TokenType;
      message?: string;
    } = body;

    // Validation
    if (!requesterAddress || !amount || !token) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (amount <= 0) {
      return NextResponse.json(
        { error: "Amount must be greater than zero" },
        { status: 400 }
      );
    }

    // Verify session signature proves ownership of requesterAddress.
    // Request creation is protocol-agnostic, so it uses the Swish-scoped
    // REQUEST_SESSION_MESSAGE rather than any single protocol's text.
    const requesterPubKey = new PublicKey(requesterAddress);
    const messageBytes = Buffer.from(REQUEST_SESSION_MESSAGE);
    const isValid = nacl.sign.detached.verify(
      messageBytes,
      sessionSigBytes,
      requesterPubKey.toBytes()
    );

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid session signature for requester address" },
        { status: 401 }
      );
    }

    // Create request
    const result = await createRequest({
      requesterAddress,
      payerAddress,
      amount,
      token,
      message,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Create request error:", error);

    return NextResponse.json(
      { error: error.message ?? "Failed to create request" },
      { status: 500 }
    );
  }
}
