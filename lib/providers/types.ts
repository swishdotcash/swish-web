import type { Connection, PublicKey } from "@solana/web3.js";
import type { TokenType } from "../privacycash/tokens";

export type ProviderId = "privacy-cash" | "magicblock-per" | "umbra";

export interface PrepareSendInput {
  connection: Connection;
  senderPublicKey: PublicKey;
  sessionSignature: Uint8Array;
  receiverAddress: string;
  amount: number;
  token: TokenType;
  message?: string;
}

export interface PrepareSendOutput {
  activityId: string;
  unsignedDepositTx: string;
  lastValidBlockHeight: number;
  estimatedFeeLamports: number;
  estimatedFeeSOL: number;
  providerContext?: Record<string, unknown>;
}

export interface SubmitSendInput {
  connection: Connection;
  signedDepositTx: string;
  sessionSignature: Uint8Array;
  activityId: string;
  senderPublicKey: PublicKey;
  receiverAddress: string;
  amount: number;
  token: TokenType;
  lastValidBlockHeight?: number;
  providerContext?: Record<string, unknown>;
}

export interface SubmitSendResult {
  activityId: string;
  depositTx: string;
  withdrawTx: string;
  providerMetadata?: Record<string, unknown>;
}

export interface PrivacySendProvider {
  id: ProviderId;
  displayName: string;
  prepare(input: PrepareSendInput): Promise<PrepareSendOutput>;
  submit(input: SubmitSendInput): Promise<SubmitSendResult>;
}
