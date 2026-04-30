"use client";

/**
 * Browser-side Umbra SDK helpers — counterpart to lib/sponsor/umbraSDK.ts
 * (server-side). These are safe to import from "use client" components
 * and run in the browser bundle.
 *
 * Used by useUmbraSend, useUmbraRegister, etc. For the architecture
 * decision behind running Umbra client-side for direct Send / Request
 * fulfill, see [Umbra pivot](memory/project_umbra_pivot_to_client_side.md).
 */

import { getUmbraClient, assertMasterSeed } from "@umbra-privacy/sdk";
import type { IUmbraClient, IUmbraSigner } from "@umbra-privacy/sdk/interfaces";
import type { MasterSeed } from "@umbra-privacy/sdk/types";
import {
  getCdnZkAssetProvider,
  getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver,
  getClaimSelfClaimableUtxoIntoEncryptedBalanceProver,
  getClaimSelfClaimableUtxoIntoPublicBalanceProver,
  getCreateReceiverClaimableUtxoFromPublicBalanceProver,
  getCreateSelfClaimableUtxoFromPublicBalanceProver,
  getUserRegistrationProver,
} from "@umbra-privacy/web-zk-prover";
import type {
  IZkProverForReceiverClaimableUtxo,
  IZkProverForSelfClaimableUtxo,
  IZkProverSuite,
} from "@umbra-privacy/sdk/interfaces";

const UMBRA_INDEXER = "https://indexer.umbraprivacy.com";

// Cached suite — circuit asset providers can be reused across all
// browser-side SDK calls within the same page session.
let cachedSuite: IZkProverSuite | null = null;

export function getBrowserUmbraProverSuite(): IZkProverSuite {
  if (cachedSuite) return cachedSuite;

  const assetProvider = getCdnZkAssetProvider();
  const deps = { assetProvider };

  // Same variance cast as the server-side suite — see umbraSDK.ts for
  // why FromPublicBalance provers need to be cast to the wider
  // I*Utxo types for the suite slots.
  const suite: IZkProverSuite = {
    registration: getUserRegistrationProver(deps),
    utxoSelfClaimable: getCreateSelfClaimableUtxoFromPublicBalanceProver(
      deps
    ) as unknown as IZkProverForSelfClaimableUtxo,
    utxoReceiverClaimable: getCreateReceiverClaimableUtxoFromPublicBalanceProver(
      deps
    ) as unknown as IZkProverForReceiverClaimableUtxo,
    claimSelfClaimableIntoEncryptedBalance:
      getClaimSelfClaimableUtxoIntoEncryptedBalanceProver(deps),
    claimReceiverClaimableIntoEncryptedBalance:
      getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver(deps),
    claimSelfClaimableIntoPublicBalance:
      getClaimSelfClaimableUtxoIntoPublicBalanceProver(deps),
  };
  cachedSuite = suite;
  return suite;
}

export interface BrowserUmbraClientArgs {
  signer: IUmbraSigner;
  rpcUrl: string;
  // Defaults to deferred (lazy master seed signing) — recommended.
  deferMasterSeedSignature?: boolean;
}

// Per-address client cache. The Umbra client caches master seed
// internally (after first derivation), so reusing the same client
// across sends in the same browser session avoids re-prompting for
// the consent signMessage on every send. Keyed by signer address so
// switching wallets invalidates the cache.
let cachedClient: {
  address: string;
  client: Promise<IUmbraClient>;
} | null = null;

// SessionStorage-backed master seed persistence. Survives page refresh
// within the same browser tab; cleared on tab close or logout. Keyed by
// wallet address so different wallets don't share keys.
//
// Trust model: same as PC's session sig today. The master seed is
// sensitive but sessionStorage is per-tab + cleared on close, which is
// acceptable for v1. For higher security, consider encrypting at rest
// with a wallet-derived key (one extra signMessage per session).

const SESSION_STORAGE_PREFIX = "umbra_master_seed:";

function masterSeedStorageKey(address: string): string {
  return `${SESSION_STORAGE_PREFIX}${address}`;
}

function makeSessionStorageMasterSeedStorage(address: string) {
  return {
    load: async () => {
      if (typeof window === "undefined") {
        return { exists: false } as const;
      }
      const stored = sessionStorage.getItem(masterSeedStorageKey(address));
      if (!stored) return { exists: false } as const;
      try {
        const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
        if (bytes.length !== 64) return { exists: false } as const;
        const seed = bytes as unknown as MasterSeed;
        assertMasterSeed(seed);
        return { exists: true, seed } as const;
      } catch {
        // Corrupt entry — clear it.
        sessionStorage.removeItem(masterSeedStorageKey(address));
        return { exists: false } as const;
      }
    },
    store: async (seed: MasterSeed) => {
      if (typeof window === "undefined") {
        return { success: false, error: "no window" } as const;
      }
      const bytes = seed as unknown as Uint8Array;
      const b64 = btoa(String.fromCharCode(...bytes));
      sessionStorage.setItem(masterSeedStorageKey(address), b64);
      return { success: true } as const;
    },
  };
}

export function clearStoredMasterSeed(address: string) {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(masterSeedStorageKey(address));
}

export async function getBrowserUmbraClient(
  args: BrowserUmbraClientArgs
): Promise<IUmbraClient> {
  if (cachedClient?.address === args.signer.address) {
    return cachedClient.client;
  }
  const wsUrl = args.rpcUrl.replace(/^https?:\/\//, "wss://");
  const masterSeedStorage = makeSessionStorageMasterSeedStorage(
    args.signer.address
  );
  const promise = getUmbraClient(
    {
      signer: args.signer,
      network: "mainnet",
      rpcUrl: args.rpcUrl,
      rpcSubscriptionsUrl: wsUrl,
      indexerApiEndpoint: UMBRA_INDEXER,
      deferMasterSeedSignature: args.deferMasterSeedSignature ?? true,
    },
    { masterSeedStorage }
  );
  cachedClient = { address: args.signer.address, client: promise };
  return promise;
}

// Clear the cached client — call on wallet disconnect / logout.
export function clearBrowserUmbraClientCache() {
  cachedClient = null;
}
