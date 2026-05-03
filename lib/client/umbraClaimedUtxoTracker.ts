"use client";

/**
 * Async server-backed tracker for already-claimed Umbra UTXO leaves.
 *
 * Per Umbra (DM 2026-05-01): `getClaimableUtxoScannerFunction` does not
 * filter out nullified UTXOs. They're shipping a standard plugin in
 * their next release; until then, dapps keep their own track. We use
 * Supabase via two thin API endpoints so the tracker works cross-
 * device, cross-browser, and survives storage clears.
 *
 * Usage pattern: callers pre-fetch claimed IDs once, then filter
 * synchronously. After a successful claim, mark the claimed UTXOs.
 *
 *   const claimed = await fetchClaimedUtxoIds(address);
 *   const unclaimed = filterUnclaimedUtxos(claimed, scannedUtxos);
 *   ...claim them...
 *   await markUtxosClaimed(address, unclaimed);
 *
 * Privacy note: the (wallet → claimed-UTXO indices) mapping creates a
 * linkage that doesn't exist on-chain. Acceptable for v1; will swap
 * for Umbra's plugin (or a hash-based scheme) before scale.
 */

interface UtxoRef {
  treeIndex: number | bigint;
  insertionIndex: number | bigint;
}

const CACHE_TTL_MS = 30_000;
let cache: { address: string; ids: Set<string>; fetchedAt: number } | null =
  null;

function utxoId(
  treeIndex: number | bigint,
  insertionIndex: number | bigint
): string {
  return `${String(treeIndex)}:${String(insertionIndex)}`;
}

/**
 * Fetch the set of claimed UTXO IDs for the given address. Cached
 * in-memory for 30s to avoid hammering the API across re-renders.
 */
export async function fetchClaimedUtxoIds(
  address: string
): Promise<Set<string>> {
  const now = Date.now();
  if (
    cache &&
    cache.address === address &&
    now - cache.fetchedAt < CACHE_TTL_MS
  ) {
    return cache.ids;
  }

  try {
    const res = await fetch(
      `/api/umbra/claimed-utxos?address=${encodeURIComponent(address)}`
    );
    if (!res.ok) {
      // Soft-fail: empty set so phantoms appear rather than blocking.
      return new Set();
    }
    const json = (await res.json()) as { ids?: string[] };
    const ids = new Set(json.ids ?? []);
    cache = { address, ids, fetchedAt: now };
    return ids;
  } catch {
    return new Set();
  }
}

/**
 * Filter UTXOs synchronously given a pre-fetched claimed set.
 */
export function filterUnclaimedUtxos<T extends UtxoRef>(
  claimedIds: Set<string>,
  utxos: readonly T[]
): T[] {
  if (claimedIds.size === 0) return [...utxos];
  return utxos.filter((u) => {
    if (u.treeIndex === undefined || u.insertionIndex === undefined) {
      return true;
    }
    return !claimedIds.has(utxoId(u.treeIndex, u.insertionIndex));
  });
}

/**
 * Mark a set of UTXOs as claimed. Call after `claimer(...)` resolves.
 * Updates the in-memory cache so the next filter sees the new IDs
 * without an API round-trip.
 */
export async function markUtxosClaimed<T extends UtxoRef>(
  address: string,
  utxos: readonly T[]
): Promise<void> {
  if (utxos.length === 0) return;

  const payload = utxos
    .filter(
      (u) => u.treeIndex !== undefined && u.insertionIndex !== undefined
    )
    .map((u) => ({
      treeIndex: Number(u.treeIndex),
      insertionIndex: Number(u.insertionIndex),
    }));

  if (payload.length === 0) return;

  try {
    await fetch("/api/umbra/claimed-utxos/mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: address, utxos: payload }),
    });

    // Update in-memory cache so subsequent filters see the new IDs.
    if (cache && cache.address === address) {
      for (const u of payload) {
        cache.ids.add(utxoId(u.treeIndex, u.insertionIndex));
      }
    }
  } catch (err) {
    // Don't throw — claim already succeeded on-chain. Worst case the
    // UI shows a phantom on next refresh, fixable next time the user
    // claims something else (or via the Umbra plugin once available).
    // eslint-disable-next-line no-console
    console.warn("[umbraClaimedUtxoTracker] mark failed:", err);
  }
}

/** Clear the in-memory cache (e.g. on wallet disconnect). */
export function clearTrackerCache() {
  cache = null;
}
