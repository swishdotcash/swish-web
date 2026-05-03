import type { ProviderId } from "./providers/types";

// Per-protocol session message constants.
// Each is the message text the user signs to produce a provider-scoped session
// signature. Used for Send & Claim sender-side burner reclaim ciphertext
// encryption (and for PC: also for the PC SDK's UTXO encryption).
//
// PC's text is hardcoded in the privacycash SDK and cannot be renamed without
// breaking PC's encryption. The MB and Umbra texts were chosen for brand
// consistency in the wallet popup when the user picks those protocols for
// Send & Claim.

export const PC_SESSION_MESSAGE = "Privacy Money account sign in";
export const MB_SESSION_MESSAGE = "Magic Block Swish sign in";
export const UMBRA_SESSION_MESSAGE = "Umbra Privacy Swish sign in";

// Protocol-agnostic operations (Request create + cancel) — these don't
// pick a protocol at create time so they use a Swish-scoped message
// instead of any protocol's text.
export const REQUEST_SESSION_MESSAGE = "Swish Request signature";

export function getSessionMessageForProvider(provider: ProviderId): string {
  switch (provider) {
    case "privacy-cash":
      return PC_SESSION_MESSAGE;
    case "magicblock-per":
      return MB_SESSION_MESSAGE;
    case "umbra":
      return UMBRA_SESSION_MESSAGE;
  }
}
