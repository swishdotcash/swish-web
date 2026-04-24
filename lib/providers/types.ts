import type { Connection, Keypair, PublicKey } from "@solana/web3.js";
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

export interface PrepareFulfillInput {
  connection: Connection;
  activityId: string;
  payerPublicKey: PublicKey;
  sessionSignature: Uint8Array;
}

export interface PrepareFulfillOutput {
  activityId: string;
  unsignedDepositTx: string;
  lastValidBlockHeight: number;
  estimatedFeeLamports: number;
  estimatedFeeSOL: number;
  amount: number;
  token: TokenType;
  receiverAddress: string;
  providerContext?: Record<string, unknown>;
}

export interface SubmitFulfillInput {
  connection: Connection;
  signedDepositTx: string;
  sessionSignature: Uint8Array;
  activityId: string;
  payerPublicKey: PublicKey;
  lastValidBlockHeight?: number;
  providerContext?: Record<string, unknown>;
}

export interface SubmitFulfillResult {
  activityId: string;
  depositTx: string;
  withdrawTx: string;
  providerMetadata?: Record<string, unknown>;
}

export interface PrepareSendClaimInput {
  connection: Connection;
  senderPublicKey: PublicKey;
  sessionSignature: Uint8Array;
  amount: number;
  token: TokenType;
  message?: string;
}

export interface PrepareSendClaimOutput {
  activityId: string;
  unsignedDepositTx: string;
  lastValidBlockHeight: number;
  passphrase: string;
  burnerAddress: string;
  estimatedFeeLamports: number;
  estimatedFeeSOL: number;
  providerContext?: Record<string, unknown>;
}

export interface SubmitSendClaimInput {
  connection: Connection;
  signedDepositTx: string;
  sessionSignature: Uint8Array;
  activityId: string;
  senderPublicKey: PublicKey;
  lastValidBlockHeight?: number;
  providerContext?: Record<string, unknown>;
}

export interface SubmitSendClaimResult {
  activityId: string;
  depositTx: string;
  withdrawTx: string;
  claimLink: string;
  burnerAddress: string;
  providerMetadata?: Record<string, unknown>;
}

export interface ClaimInput {
  connection: Connection;
  activityId: string;
  passphrase: string;
  receiverAddress: string;
  sponsorKeypair: Keypair;
}

export interface ClaimResult {
  activityId: string;
  claimTx: string;
  amountReceived: number;
  token: TokenType;
  providerMetadata?: Record<string, unknown>;
}

export interface ReclaimInput {
  connection: Connection;
  activityId: string;
  sessionSignature: Uint8Array;
  senderPublicKey: PublicKey;
  sponsorKeypair: Keypair;
}

export interface ReclaimResult {
  activityId: string;
  reclaimTx: string;
  amountReclaimed: number;
  token: TokenType;
  providerMetadata?: Record<string, unknown>;
}

export interface PrivacySendProvider {
  id: ProviderId;
  displayName: string;
  prepare(input: PrepareSendInput): Promise<PrepareSendOutput>;
  submit(input: SubmitSendInput): Promise<SubmitSendResult>;
  prepareFulfill(input: PrepareFulfillInput): Promise<PrepareFulfillOutput>;
  submitFulfill(input: SubmitFulfillInput): Promise<SubmitFulfillResult>;
  prepareSendClaim(input: PrepareSendClaimInput): Promise<PrepareSendClaimOutput>;
  submitSendClaim(input: SubmitSendClaimInput): Promise<SubmitSendClaimResult>;
  claim(input: ClaimInput): Promise<ClaimResult>;
  reclaim(input: ReclaimInput): Promise<ReclaimResult>;
}
