import { prepareSend, submitSend } from "../sponsor/prepareAndSubmitSend";
import {
  prepareFulfill,
  submitFulfill,
} from "../sponsor/prepareAndSubmitFulfill";
import {
  claimWithPassphrase,
  prepareClaim,
  reclaimWithSignature,
  submitClaim,
} from "../sponsor/prepareAndSubmitClaim";
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

export const privacyCashProvider: PrivacySendProvider = {
  id: "privacy-cash",
  displayName: "Privacy Cash",

  async prepare(input: PrepareSendInput): Promise<PrepareSendOutput> {
    const result = await prepareSend({
      connection: input.connection,
      senderPublicKey: input.senderPublicKey,
      sessionSignature: input.sessionSignature,
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
    };
  },

  async submit(input: SubmitSendInput): Promise<SubmitSendResult> {
    const result = await submitSend({
      connection: input.connection,
      signedDepositTx: input.signedDepositTx,
      sessionSignature: input.sessionSignature,
      activityId: input.activityId,
      senderPublicKey: input.senderPublicKey,
      receiverAddress: input.receiverAddress,
      amount: input.amount,
      token: input.token,
      lastValidBlockHeight: input.lastValidBlockHeight,
      providerId: this.id,
    });

    return {
      activityId: result.activityId,
      depositTx: result.depositTx,
      withdrawTx: result.withdrawTx,
    };
  },

  async prepareFulfill(input: PrepareFulfillInput): Promise<PrepareFulfillOutput> {
    const result = await prepareFulfill({
      connection: input.connection,
      activityId: input.activityId,
      payerPublicKey: input.payerPublicKey,
      sessionSignature: input.sessionSignature,
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
    };
  },

  async submitFulfill(input: SubmitFulfillInput): Promise<SubmitFulfillResult> {
    const result = await submitFulfill({
      connection: input.connection,
      signedDepositTx: input.signedDepositTx,
      sessionSignature: input.sessionSignature,
      activityId: input.activityId,
      payerPublicKey: input.payerPublicKey,
      lastValidBlockHeight: input.lastValidBlockHeight,
      providerId: this.id,
    });

    return {
      activityId: result.activityId,
      depositTx: result.depositTx,
      withdrawTx: result.withdrawTx,
    };
  },

  async prepareSendClaim(input: PrepareSendClaimInput): Promise<PrepareSendClaimOutput> {
    const result = await prepareClaim({
      connection: input.connection,
      senderPublicKey: input.senderPublicKey,
      sessionSignature: input.sessionSignature,
      amount: input.amount,
      token: input.token,
      message: input.message,
      providerId: this.id,
    });

    return {
      activityId: result.activityId,
      unsignedDepositTx: result.unsignedDepositTx,
      lastValidBlockHeight: result.lastValidBlockHeight,
      passphrase: result.passphrase,
      burnerAddress: result.burnerAddress,
      estimatedFeeLamports: result.estimatedFeeLamports,
      estimatedFeeSOL: result.estimatedFeeSOL,
    };
  },

  async submitSendClaim(input: SubmitSendClaimInput): Promise<SubmitSendClaimResult> {
    const result = await submitClaim({
      connection: input.connection,
      signedDepositTx: input.signedDepositTx,
      sessionSignature: input.sessionSignature,
      activityId: input.activityId,
      senderPublicKey: input.senderPublicKey,
      lastValidBlockHeight: input.lastValidBlockHeight,
    });

    return {
      activityId: result.activityId,
      depositTx: result.depositTx,
      withdrawTx: result.withdrawTx,
      claimLink: result.claimLink,
      burnerAddress: result.burnerAddress,
    };
  },

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const result = await claimWithPassphrase({
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
    const result = await reclaimWithSignature({
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
