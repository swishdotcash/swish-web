/**
 * Thin REST client for MagicBlock Private Payments API.
 *
 * Surface used by Swish: /transfer (private USDC routes through the
 * validator's TEE, settling base→base from sender's mainnet ATA to
 * receiver's mainnet ATA).
 *
 * /deposit and /withdraw are not used for the base→base flows in
 * PR 5a — added here only as types in case PR 5b needs them.
 */

const DEFAULT_BASE_URL = "https://payments.magicblock.app";

export type BalanceLocation = "base" | "ephemeral";
export type TransferVisibility = "public" | "private";

export interface UnsignedTransactionResponse {
  kind: "deposit" | "withdraw" | "transfer";
  version: "legacy" | "v0";
  transactionBase64: string;
  sendTo: BalanceLocation;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  instructionCount: number;
  requiredSigners: string[];
  validator?: string;
}

export interface MagicBlockTransferRequest {
  from: string;
  to: string;
  mint: string;
  amount: number; // base units (integer)
  visibility: TransferVisibility;
  fromBalance: BalanceLocation;
  toBalance: BalanceLocation;
  validator?: string;
  initIfMissing?: boolean;
  initAtasIfMissing?: boolean;
  initVaultIfMissing?: boolean;
  memo?: string;
  // Private-only:
  minDelayMs?: string;
  maxDelayMs?: string;
  clientRefId?: string;
  legacy?: boolean;
}

export interface MagicBlockApiError extends Error {
  code?: string;
  status?: number;
  issues?: unknown;
}

function buildError(message: string, extras: Partial<MagicBlockApiError>): MagicBlockApiError {
  const err = new Error(message) as MagicBlockApiError;
  if (extras.code) err.code = extras.code;
  if (extras.status) err.status = extras.status;
  if (extras.issues) err.issues = extras.issues;
  return err;
}

function getBaseUrl(): string {
  return process.env.MAGICBLOCK_PAYMENTS_API_URL || DEFAULT_BASE_URL;
}

export async function magicBlockTransfer(
  body: MagicBlockTransferRequest
): Promise<UnsignedTransactionResponse> {
  const res = await fetch(`${getBaseUrl()}/v1/spl/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as
    | UnsignedTransactionResponse
    | { error: { code: string; message: string; issues?: unknown } };

  if (!res.ok || "error" in json) {
    const err = "error" in json ? json.error : { code: "UNKNOWN", message: res.statusText };
    throw buildError(`MagicBlock /transfer failed: ${err.message}`, {
      code: err.code,
      status: res.status,
      issues: "issues" in err ? err.issues : undefined,
    });
  }

  return json;
}

export async function magicBlockHealth(): Promise<{ status: "ok" | string }> {
  const res = await fetch(`${getBaseUrl()}/health`);
  if (!res.ok) {
    throw buildError(`MagicBlock /health failed: ${res.statusText}`, { status: res.status });
  }
  return (await res.json()) as { status: "ok" | string };
}
