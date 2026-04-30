import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

import { SESSION_MESSAGE } from "@/lib/sponsor/prepareAndSubmitSend";
import { TokenType } from "@/lib/privacycash/tokens";
import {
  DEFAULT_PROVIDER_ID,
  getProvider,
  isProviderId,
  type ProviderId,
} from "@/lib/providers";
import { getActivity } from "@/lib/database";

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
      receiverAddress,
      amount,
      token,
      lastValidBlockHeight,
      providerId: providerIdInput,
      providerContext,
    }: {
      signedDepositTx: string;
      activityId: string;
      senderPublicKey: string;
      receiverAddress: string;
      amount: number;
      token: TokenType;
      lastValidBlockHeight?: number;
      providerId?: string;
      providerContext?: Record<string, unknown>;
    } = body;

    // Validation
    if (!signedDepositTx || !activityId || !senderPublicKey || !receiverAddress || !amount || !token) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Resolve provider from the activity row first — prepare may have
    // stamped it at create (Umbra burner pattern). Fall back to body's
    // providerId or default for legacy/PC flows that stamp at settle.
    const activity = await getActivity(activityId);
    if (!activity) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    let providerId: ProviderId = DEFAULT_PROVIDER_ID;
    if (activity.provider_id && isProviderId(activity.provider_id)) {
      providerId = activity.provider_id;
    } else if (providerIdInput) {
      if (!isProviderId(providerIdInput)) {
        return NextResponse.json(
          { error: `Unknown providerId: ${providerIdInput}` },
          { status: 400 }
        );
      }
      providerId = providerIdInput;
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
    const result = await provider.submit({
      connection,
      signedDepositTx,
      sessionSignature: sessionSigBytes,
      activityId,
      senderPublicKey: senderPubKey,
      receiverAddress,
      amount,
      token,
      lastValidBlockHeight,
      providerContext,
    });

    return NextResponse.json({ ...result, providerId });
  } catch (error: any) {
    console.error("Submit send error:", error);

    if (error.message === "Transaction expired. Please prepare again.") {
      return NextResponse.json(
        { error: "Transaction expired. Please prepare again." },
        { status: 408 } // Request Timeout
      );
    }

    return NextResponse.json(
      { error: error.message ?? "Failed to submit send" },
      { status: 500 }
    );
  }
}
