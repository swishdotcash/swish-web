import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";

import {
  DEFAULT_PROVIDER_ID,
  getProvider,
  isProviderId,
  type ProviderId,
} from "@/lib/providers";
import { getActivity } from "@/lib/database";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      activityId,
      passphrase,
      receiverAddress,
    }: {
      activityId: string;
      passphrase: string;
      receiverAddress: string;
    } = body;

    // Validation
    if (!activityId || !passphrase || !receiverAddress) {
      return NextResponse.json(
        { error: "Missing required fields: activityId, passphrase, receiverAddress" },
        { status: 400 }
      );
    }

    // provider_id is stamped on the row at prepare time; read it back to dispatch.
    // The claimer is a different user from the sender, so we can't trust a body param.
    const activity = await getActivity(activityId);
    if (!activity) {
      return NextResponse.json({ error: "Claim link not found" }, { status: 404 });
    }
    const providerId: ProviderId = isProviderId(activity.provider_id ?? "")
      ? (activity.provider_id as ProviderId)
      : DEFAULT_PROVIDER_ID;

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

    // Execute claim via provider
    const provider = getProvider(providerId);
    const result = await provider.claim({
      connection,
      activityId,
      passphrase,
      receiverAddress,
      sponsorKeypair,
    });

    return NextResponse.json({ ...result, providerId });
  } catch (error: any) {
    console.error("Claim error:", error);

    if (error.message === "Claim link not found") {
      return NextResponse.json({ error: "Claim link not found" }, { status: 404 });
    }

    if (error.message === "Claim link already used or cancelled") {
      return NextResponse.json(
        { error: "Claim link already used or cancelled" },
        { status: 410 }
      );
    }

    if (error.message === "Invalid passphrase") {
      return NextResponse.json({ error: "Invalid passphrase" }, { status: 401 });
    }

    return NextResponse.json(
      { error: error.message ?? "Failed to claim" },
      { status: 500 }
    );
  }
}
