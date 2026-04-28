import { magicBlockProvider } from "./magicBlockProvider";
import { privacyCashProvider } from "./privacyCashProvider";
import type { PrivacySendProvider, ProviderId } from "./types";

const providers: Record<ProviderId, PrivacySendProvider | undefined> = {
  "privacy-cash": privacyCashProvider,
  "magicblock-per": magicBlockProvider,
  "umbra": undefined,
};

export const DEFAULT_PROVIDER_ID: ProviderId = "privacy-cash";

export function getProvider(id: ProviderId = DEFAULT_PROVIDER_ID): PrivacySendProvider {
  const provider = providers[id];
  if (!provider) {
    throw new Error(`Provider '${id}' is not available`);
  }
  return provider;
}

export function listProviders(): PrivacySendProvider[] {
  return Object.values(providers).filter(
    (p): p is PrivacySendProvider => p !== undefined
  );
}

export function isProviderId(id: string): id is ProviderId {
  return id === "privacy-cash" || id === "magicblock-per" || id === "umbra";
}
