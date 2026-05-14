/**
 * Per-protocol fee estimation. Pure client-side functions — caller passes
 * the amount and PC's dynamic base fee, gets back a fee in USDC.
 *
 * Per-protocol summary:
 *   PC     $0.71 base + 0.35%          (Pyth-derived base + bps)
 *   MB     0.1%                        (verified live 2026-05-14: $1 send
 *                                       debited 1.001, $2 debited 2.002. Not
 *                                       in MB's OpenAPI spec but empirically
 *                                       consistent. Charged on top of the
 *                                       sender — MB's exactOut flag does not
 *                                       move it off the sender; both values
 *                                       tested live.)
 *   Umbra  0.7% on claim, all flows    (claim is unavoidable — SDK has no
 *                                       receiver-side path that skips it)
 *
 * Each estimate also reports `chargedOnTop`: true means the sender's wallet
 * is debited amount + fee (MB); false means the recipient receives
 * amount - fee (PC, Umbra). Drives the balance check and the
 * "You Pay" / "They Receive" display in the send UI.
 */

import type { ProviderId } from "./providers/types";

export interface FeeEstimate {
  feeUSDC: number;
  breakdown: string;
  // true  → sender pays amount + fee (fee is on top)
  // false → recipient gets amount - fee (fee comes out of the amount)
  chargedOnTop: boolean;
}

export type FlowKind = "send" | "fulfill" | "send_claim";

// PC: dynamic base ($0.71-ish via Pyth) + 0.35% bps
export function estimatePcFee(
  amount: number,
  baseFeeUSDC: number
): FeeEstimate {
  const bpsFee = amount * 0.0035;
  return {
    feeUSDC: baseFeeUSDC + bpsFee,
    breakdown: `${baseFeeUSDC.toFixed(2)} USDC base + 0.35%`,
    chargedOnTop: false,
  };
}

// MB: 0.1% on the transfer amount, charged on top of the sender (a $1 send
// debits 1.001). Verified live 2026-05-14 — not in MB's OpenAPI spec but
// consistent across test sends. MB's exactOut flag does not move the fee off
// the sender (both values tested live).
export function estimateMbFee(amount: number): FeeEstimate {
  return {
    feeUSDC: amount * 0.001,
    breakdown: "0.1%",
    chargedOnTop: true,
  };
}

// Umbra: 0.7% on claim, regardless of flow. Verified from SDK fee providers:
//   getHardcodedDepositProtocolFeeProvider:    0 BPS
//   getHardcodedCreateUtxoProtocolFeeProvider: 0 BPS
//   getHardcodedWithdrawalProtocolFeeProvider: 0 BPS
//   getHardcodedClaimUtxoProtocolFeeProvider:  35 BPS
//   getHardcodedClaimUtxoRelayerFeeProvider:   35 BPS
//
// Why all three flows pay it:
//   - Direct Send / Request fulfill: recipient lands an encrypted UTXO; the
//     ONLY SDK path to access it is `getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction`
//     which fires the 0.7% claim. Withdraw to public ATA after that is 0 BPS.
//   - Send & Claim: claim fires inside our burner flow when the link is opened.
//
// We surface the fee at send time (subtracted from "they receive") because
// the recipient effectively receives `amount - 0.7%` of usable USDC.
export function estimateUmbraFee(amount: number, _flow: FlowKind): FeeEstimate {
  const fee = amount * 0.007;
  return {
    feeUSDC: fee,
    breakdown: "0.7% on claim",
    chargedOnTop: false,
  };
}

/**
 * Resolve the fee for a given protocol + flow + amount. PC requires the
 * current Pyth-derived base fee (caller fetches via useFee).
 *
 * For provider="auto" (no specific protocol picked yet — typically before
 * a receiver is entered), shows MB. With no receiver, Umbra is ineligible
 * and the router picks MB if live; PC is only the fallback-of-fallback if
 * MB is down.
 */
export function estimateFee(
  provider: ProviderId | "auto",
  amount: number,
  flow: FlowKind,
  pcBaseFeeUSDC: number
): FeeEstimate {
  switch (provider) {
    case "privacy-cash":
      return estimatePcFee(amount, pcBaseFeeUSDC);
    case "magicblock-per":
    case "auto":
      return estimateMbFee(amount);
    case "umbra":
      return estimateUmbraFee(amount, flow);
  }
}
