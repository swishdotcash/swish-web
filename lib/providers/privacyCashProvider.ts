import { prepareSend, submitSend } from "../sponsor/prepareAndSubmitSend";
import {
  prepareFulfill,
  submitFulfill,
} from "../sponsor/prepareAndSubmitFulfill";
import type {
  PrepareFulfillInput,
  PrepareFulfillOutput,
  PrepareSendInput,
  PrepareSendOutput,
  PrivacySendProvider,
  SubmitFulfillInput,
  SubmitFulfillResult,
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
};
