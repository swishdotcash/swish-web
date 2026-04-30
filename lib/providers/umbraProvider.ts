/**
 * Umbra provider.
 *
 * Direct Send + Request fulfill go through the burner pattern:
 *   1. Server creates fresh burner per send
 *   2. Sender signs ONE SPL transfer (sender ATA → burner ATA), sponsor
 *      pays SOL fee, sponsor pre-signs as fee payer
 *   3. Server runs Umbra registration + receiver-claimable deposit as
 *      the burner (server-side, sponsored SOL fees)
 *   4. UTXO lands locked to recipient's commitment; recipient claims via
 *      their own Umbra account independently
 *
 * Send & Claim methods (prepareSendClaim / submitSendClaim / claim /
 * reclaim) throw "not implemented" — coming in a future commit once we
 * verify the Umbra relayer + claim flow.
 *
 * See [Umbra architecture decision](memory/project_umbra_architecture_decision.md).
 */

import {
  prepareUmbraFulfill,
  prepareUmbraSend,
  submitUmbraFulfill,
  submitUmbraSend,
} from "../sponsor/umbraSend";
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

const NOT_IMPLEMENTED_SC =
  "Umbra Send & Claim is not yet implemented (coming in a follow-up)";

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
    throw new Error(NOT_IMPLEMENTED_SC);
  },

  async submitSendClaim(
    _input: SubmitSendClaimInput
  ): Promise<SubmitSendClaimResult> {
    throw new Error(NOT_IMPLEMENTED_SC);
  },

  async claim(_input: ClaimInput): Promise<ClaimResult> {
    throw new Error(NOT_IMPLEMENTED_SC);
  },

  async reclaim(_input: ReclaimInput): Promise<ReclaimResult> {
    throw new Error(NOT_IMPLEMENTED_SC);
  },
};
