import { isProviderId, type ProviderId } from "./types";

// Reads NEXT_PUBLIC_DISABLED_PROVIDERS as a comma-separated list of
// ProviderId values. NEXT_PUBLIC_ prefix is required so both server-side
// (auto router, prepare endpoints) and client-side (picker, banner) read
// the same value. Unknown ids are silently dropped.
export function getDisabledProviderIds(): ProviderId[] {
  const raw = process.env.NEXT_PUBLIC_DISABLED_PROVIDERS ?? "";
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is ProviderId => s.length > 0 && isProviderId(s));
}

export function isProviderDisabled(id: ProviderId): boolean {
  return getDisabledProviderIds().includes(id);
}

export function areAllProvidersDisabled(ids: ProviderId[]): boolean {
  return ids.length > 0 && ids.every(isProviderDisabled);
}
