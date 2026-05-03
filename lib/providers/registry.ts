import { magicBlockProvider } from "./magicBlockProvider";
import { privacyCashProvider } from "./privacyCashProvider";
import { umbraProvider } from "./umbraProvider";
import {
  DEFAULT_PROVIDER_ID,
  isProviderId,
  type PrivacySendProvider,
  type ProviderId,
} from "./types";

// Re-export constants and type guards from types.ts for backward
// compatibility with code that imports them from here.
export { DEFAULT_PROVIDER_ID, isProviderId };

const providers: Record<ProviderId, PrivacySendProvider | undefined> = {
  "privacy-cash": privacyCashProvider,
  "magicblock-per": magicBlockProvider,
  "umbra": umbraProvider,
};

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
