import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

import { cancelRequest } from "@/lib/operations/request";
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
      activityId,
      requesterAddress,
    }: {
      activityId: string;
      requesterAddress: string;
    } = body;

    // Validation
    if (!activityId || !requesterAddress) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Parse inputs
    const requesterPubKey = new PublicKey(requesterAddress);

    // Verify session signature proves ownership of requesterAddress.
    // Cancel is protocol-agnostic — uses REQUEST_SESSION_MESSAGE.
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

    // Cancel request
    await cancelRequest(activityId, requesterAddress);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Cancel request error:", error);

    if (error.message === "Request not found") {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (error.message === "Not the requester") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    if (error.message === "Request already fulfilled or cancelled") {
      return NextResponse.json(
        { error: "Request already fulfilled or cancelled" },
        { status: 410 }
      );
    }

    return NextResponse.json(
      { error: error.message ?? "Failed to cancel request" },
      { status: 500 }
    );
  }
}
