import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

import { getActivity, updateActivityStatus } from "@/lib/database";
import {
  DEFAULT_PROVIDER_ID,
  isProviderId,
  type ProviderId,
} from "@/lib/providers";
import { getSessionMessageForProvider } from "@/lib/session-messages";

export async function POST(request: NextRequest) {
  try {
    // Verify session signature
    const sessionSignature = request.headers.get("X-Session-Signature");
    if (!sessionSignature) {
      return NextResponse.json(
        { error: "Missing session signature" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { activityId, senderPublicKey } = body;

    if (!activityId || !senderPublicKey) {
      return NextResponse.json(
        { error: "Missing activityId or senderPublicKey" },
        { status: 400 }
      );
    }

    // Get activity first — provider_id determines which session message
    // to verify the sig against.
    const activity = await getActivity(activityId);
    if (!activity) {
      return NextResponse.json(
        { error: "Activity not found" },
        { status: 404 }
      );
    }

    const providerId: ProviderId = isProviderId(activity.provider_id ?? "")
      ? (activity.provider_id as ProviderId)
      : DEFAULT_PROVIDER_ID;

    // Verify signature against the protocol-matching message
    const senderPubKey = new PublicKey(senderPublicKey);
    const sessionMessage = getSessionMessageForProvider(providerId);
    const messageBytes = Buffer.from(sessionMessage);
    const signatureBytes = Buffer.from(sessionSignature, "base64");

    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      senderPubKey.toBytes()
    );

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid session signature" },
        { status: 401 }
      );
    }

    // Only allow cancelling if sender owns this activity
    if (activity.sender_address?.toLowerCase() !== senderPublicKey.toLowerCase()) {
      return NextResponse.json(
        { error: "Not authorized to cancel this activity" },
        { status: 403 }
      );
    }

    // Only allow cancelling open activities
    if (activity.status !== "open") {
      return NextResponse.json(
        { error: `Activity is already ${activity.status}` },
        { status: 400 }
      );
    }

    // Cancel the activity
    await updateActivityStatus(activityId, "cancelled");

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Cancel activity error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to cancel activity" },
      { status: 500 }
    );
  }
}
