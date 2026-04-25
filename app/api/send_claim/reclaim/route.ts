import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { SESSION_MESSAGE } from "@/lib/sponsor/prepareAndSubmitSend";
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
      activityId,
      senderPublicKey,
    }: {
      activityId: string;
      senderPublicKey: string;
    } = body;

    // Validation
    if (!activityId || !senderPublicKey) {
      return NextResponse.json(
        { error: "Missing required fields: activityId, senderPublicKey" },
        { status: 400 }
      );
    }

    // provider_id is stamped on the row at prepare time; read it back to dispatch.
    const activity = await getActivity(activityId);
    if (!activity) {
      return NextResponse.json({ error: "Claim link not found" }, { status: 404 });
    }
    const providerId: ProviderId = isProviderId(activity.provider_id ?? "")
      ? (activity.provider_id as ProviderId)
      : DEFAULT_PROVIDER_ID;

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

    // Get sponsor keypair (for gas)
    const sponsorKey = process.env.SPONSOR_PRIVATE_KEY;
    if (!sponsorKey) {
      return NextResponse.json(
        { error: "SPONSOR_PRIVATE_KEY not configured" },
        { status: 500 }
      );
    }
    const sponsorKeypair = Keypair.fromSecretKey(bs58.decode(sponsorKey));

    // Get connection
    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json(
        { error: "RPC_URL not configured" },
        { status: 500 }
      );
    }
    const connection = new Connection(rpcUrl, "confirmed");

    // Execute reclaim via provider
    const provider = getProvider(providerId);
    const result = await provider.reclaim({
      connection,
      activityId,
      sessionSignature: sessionSigBytes,
      senderPublicKey: senderPubKey,
      sponsorKeypair,
    });

    return NextResponse.json({ ...result, providerId });
  } catch (error: any) {
    console.error("Reclaim error:", error);

    if (error.message === "Claim link not found") {
      return NextResponse.json({ error: "Claim link not found" }, { status: 404 });
    }

    if (error.message === "Claim link already used or cancelled") {
      return NextResponse.json(
        { error: "Claim link already used or cancelled" },
        { status: 410 }
      );
    }

    if (error.message === "Not authorized to reclaim this link") {
      return NextResponse.json(
        { error: "Not authorized to reclaim this link" },
        { status: 403 }
      );
    }

    if (error.message === "Invalid session signature") {
      return NextResponse.json({ error: "Invalid session signature" }, { status: 401 });
    }

    return NextResponse.json(
      { error: error.message ?? "Failed to reclaim" },
      { status: 500 }
    );
  }
}
