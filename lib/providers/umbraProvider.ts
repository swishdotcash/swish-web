/**
 * Umbra provider.
 *
 * Direct Send + Request fulfill: client-side Umbra Direct Send via
 * `useUmbraSend` / `useUmbraFulfill`. The provider's `prepare`/`submit`
 * methods here are kept for the burner-pattern fallback path but are
 * no longer the primary route.
 *
 * Send & Claim: flipped burner pattern (since 2026-05-03). Sender
 * does Umbra Direct Send to a per-SC burner client-side. Server
 * pre-registers burner via /api/umbra/sc/prepare and finalises via
 * /api/umbra/sc/record. Provider's `prepareSendClaim` / `submitSendClaim`
 * throw — clients dispatch through the dedicated endpoints. `claim` and
 * `reclaim` are still routed through this provider (the standard
 * `/api/send_claim/[id]` and `/reclaim` routes dispatch from the
 * activity's stamped provider_id).
 *
 * See [Umbra architecture decision](memory/project_umbra_architecture_decision.md).
 */

import {
  prepareUmbraFulfill,
  prepareUmbraSend,
  submitUmbraFulfill,
  submitUmbraSend,
} from "../sponsor/umbraSend";
import {
  claimUmbraSendClaim,
  reclaimUmbraSendClaim,
} from "../sponsor/umbraSendClaim";
import type {
  ClaimInput,
  ClaimResult,
  PrepareFulfillInput,
  PrepareFulfillOutput,
  PrepareSendClaimInput,
  PrepareSendClaimOutput,
  PrepareSendInput,
  PrepareSendOutput,
  PrivacySendProvider,
  ReclaimInput,
  ReclaimResult,
  SubmitFulfillInput,
  SubmitFulfillResult,
  SubmitSendClaimInput,
  SubmitSendClaimResult,
  SubmitSendInput,
  SubmitSendResult,
} from "./types";

export const umbraProvider: PrivacySendProvider = {
  id: "umbra",
  displayName: "Umbra",

  async prepare(input: PrepareSendInput): Promise<PrepareSendOutput> {
    const result = await prepareUmbraSend({
      connection: input.connection,
      senderPublicKey: input.senderPublicKey,
      receiverAddress: input.receiverAddress,
      amount: input.amount,
      token: input.token,
      message: input.message,
    });
    return {
      activityId: result.activityId,
      unsignedDepositTx: result.unsignedDepositTx,
      lastValidBlockHeight: result.lastValidBlockHeight,
      estimatedFeeLamports: result.estimatedFeeLamports,
      estimatedFeeSOL: result.estimatedFeeSOL,
      providerContext: result.providerContext as Record<string, unknown>,
    };
  },

  async submit(input: SubmitSendInput): Promise<SubmitSendResult> {
    const result = await submitUmbraSend({
      connection: input.connection,
      signedDepositTx: input.signedDepositTx,
      activityId: input.activityId,
      senderPublicKey: input.senderPublicKey,
      receiverAddress: input.receiverAddress,
      amount: input.amount,
      token: input.token,
      lastValidBlockHeight: input.lastValidBlockHeight,
    });
    return {
      activityId: result.activityId,
      depositTx: result.depositTx,
      withdrawTx: result.withdrawTx,
      providerMetadata: { burnerAddress: result.burnerAddress },
    };
  },

  async prepareFulfill(
    input: PrepareFulfillInput
  ): Promise<PrepareFulfillOutput> {
    const result = await prepareUmbraFulfill({
      connection: input.connection,
      activityId: input.activityId,
      payerPublicKey: input.payerPublicKey,
    });
    return {
      activityId: result.activityId,
      unsignedDepositTx: result.unsignedDepositTx,
      lastValidBlockHeight: result.lastValidBlockHeight,
      estimatedFeeLamports: result.estimatedFeeLamports,
      estimatedFeeSOL: result.estimatedFeeSOL,
      amount: result.amount,
      token: result.token,
      receiverAddress: result.receiverAddress,
      providerContext: result.providerContext as Record<string, unknown>,
    };
  },

  async submitFulfill(
    input: SubmitFulfillInput
  ): Promise<SubmitFulfillResult> {
    const result = await submitUmbraFulfill({
      connection: input.connection,
      signedDepositTx: input.signedDepositTx,
      activityId: input.activityId,
      payerPublicKey: input.payerPublicKey,
      lastValidBlockHeight: input.lastValidBlockHeight,
    });
    return {
      activityId: result.activityId,
      depositTx: result.depositTx,
      withdrawTx: result.withdrawTx,
      providerMetadata: { burnerAddress: result.burnerAddress },
    };
  },

  async prepareSendClaim(
    _input: PrepareSendClaimInput
  ): Promise<PrepareSendClaimOutput> {
    throw new Error(
      "Umbra Send & Claim uses a client-side flow — call /api/umbra/sc/prepare directly instead of the standard prepare route."
    );
  },

  async submitSendClaim(
    _input: SubmitSendClaimInput
  ): Promise<SubmitSendClaimResult> {
    throw new Error(
      "Umbra Send & Claim uses a client-side flow — call /api/umbra/sc/record directly instead of the standard submit route."
    );
  },

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const result = await claimUmbraSendClaim({
      connection: input.connection,
      activityId: input.activityId,
      passphrase: input.passphrase,
      receiverAddress: input.receiverAddress,
      sponsorKeypair: input.sponsorKeypair,
      providerId: this.id,
    });
    return {
      activityId: result.activityId,
      claimTx: result.claimTx,
      amountReceived: result.amountReceived,
      token: result.token,
    };
  },

  async reclaim(input: ReclaimInput): Promise<ReclaimResult> {
    const result = await reclaimUmbraSendClaim({
      connection: input.connection,
      activityId: input.activityId,
      sessionSignature: input.sessionSignature,
      senderPublicKey: input.senderPublicKey,
      sponsorKeypair: input.sponsorKeypair,
    });
    return {
      activityId: result.activityId,
      reclaimTx: result.reclaimTx,
      amountReclaimed: result.amountReclaimed,
      token: result.token,
    };
  },
};
