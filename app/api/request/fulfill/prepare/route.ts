import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

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
      activityId,
      payerPublicKey,
      providerId: providerIdInput,
    }: {
      activityId: string;
      payerPublicKey: string;
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
    if (!activityId || !payerPublicKey) {
      return NextResponse.json(
        { error: "Missing required fields: activityId, payerPublicKey" },
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

    // Execute prepare via provider - user pays their own gas fees
    const provider = getProvider(providerId);
    const result = await provider.prepareFulfill({
      connection,
      activityId,
      payerPublicKey: payerPubKey,
      sessionSignature: sessionSigBytes,
    });

    return NextResponse.json({ ...result, providerId });
  } catch (error: any) {
    console.error("Prepare fulfill error:", error);

    if (error.message === "Request not found") {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (error.message === "Not a payment request") {
      return NextResponse.json({ error: "Not a payment request" }, { status: 400 });
    }

    if (error.message === "Request already fulfilled or cancelled") {
      return NextResponse.json(
        { error: "Request already fulfilled or cancelled" },
        { status: 410 }
      );
    }

    if (error.message === "Not authorized to fulfill this request") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    return NextResponse.json(
      { error: error.message ?? "Failed to prepare fulfill" },
      { status: 500 }
    );
  }
}
