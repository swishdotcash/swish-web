import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

import { TokenType } from "@/lib/privacycash/tokens";
import { prepareUmbraScBurner } from "@/lib/sponsor/umbraSendClaim";
import { getSessionMessageForProvider } from "@/lib/session-messages";

/**
 * POST /api/umbra/sc/prepare
 *
 * Server-side burner provisioning for Umbra Send & Claim. Generates a
 * fresh burner, registers it on Umbra (sponsored ~$0.60), persists an
 * activity row in `processing` state with the burner key encrypted for
 * receiver (passphrase) + sender (session sig).
 *
 * Returns the burner address — the client will then run an Umbra Direct
 * Send to that address client-side (3 wallet sigs), and call
 * /api/umbra/sc/record when the deposit completes.
 */
export async function POST(request: NextRequest) {
  try {
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
    }: {
      senderPublicKey: string;
      amount: number;
      token: TokenType;
      message?: string;
    } = body;

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

    const senderPubKey = new PublicKey(senderPublicKey);

    // Verify session sig against Umbra-specific session message — same
    // pattern as standard prepare route.
    const sessionMessage = getSessionMessageForProvider("umbra");
    const isValid = nacl.sign.detached.verify(
      Buffer.from(sessionMessage),
      sessionSigBytes,
      senderPubKey.toBytes()
    );
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid session signature for sender address" },
        { status: 401 }
      );
    }

    const result = await prepareUmbraScBurner({
      senderPublicKey: senderPubKey,
      sessionSignature: sessionSigBytes,
      amount,
      token,
      message,
      providerId: "umbra",
    });

    return NextResponse.json({
      activityId: result.activityId,
      burnerAddress: result.burnerAddress,
      passphrase: result.passphrase,
      sessionMessage,
    });
  } catch (err: any) {
    console.error("Umbra SC prepare error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to prepare Umbra SC" },
      { status: 500 }
    );
  }
}
