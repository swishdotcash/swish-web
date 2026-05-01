/**
 * Per-protocol fee estimation. Pure client-side functions — caller passes
 * the amount and PC's dynamic base fee, gets back a fee in USDC.
 *
 * Per-protocol summary:
 *   PC     $0.71 base + 0.35%          (Pyth-derived base + bps)
 *   MB     gas only                    (published 0.002 SOL + 0.1% not firing
 *                                       on mainnet today; revisit on audit)
 *   Umbra  0.7% on claim, all flows    (claim is unavoidable — SDK has no
 *                                       receiver-side path that skips it)
 */

import type { ProviderId } from "./providers/types";

export interface FeeEstimate {
  feeUSDC: number;
  breakdown: string;
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
  };
}

// MB: protocol charges 0 in practice (gas-only), sponsor pays the gas
export function estimateMbFee(_amount: number): FeeEstimate {
  return {
    feeUSDC: 0,
    breakdown: "gas only",
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
  };
}

/**
 * Resolve the fee for a given protocol + flow + amount. PC requires the
 * current Pyth-derived base fee (caller fetches via useFee).
 *
 * For provider="auto" (no specific protocol picked), falls back to PC —
 * that's the auto-router default route. UI should note "may differ if
 * routed elsewhere."
 */
export function estimateFee(
  provider: ProviderId | "auto",
  amount: number,
  flow: FlowKind,
  pcBaseFeeUSDC: number
): FeeEstimate {
  switch (provider) {
    case "privacy-cash":
    case "auto":
      return estimatePcFee(amount, pcBaseFeeUSDC);
    case "magicblock-per":
      return estimateMbFee(amount);
    case "umbra":
      return estimateUmbraFee(amount, flow);
  }
}
