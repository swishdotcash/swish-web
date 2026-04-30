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

import { getUmbraClient } from "@umbra-privacy/sdk";
import type { IUmbraClient, IUmbraSigner } from "@umbra-privacy/sdk/interfaces";
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

export async function getBrowserUmbraClient(
  args: BrowserUmbraClientArgs
): Promise<IUmbraClient> {
  const wsUrl = args.rpcUrl.replace(/^https?:\/\//, "wss://");
  return getUmbraClient({
    signer: args.signer,
    network: "mainnet",
    rpcUrl: args.rpcUrl,
    rpcSubscriptionsUrl: wsUrl,
    indexerApiEndpoint: UMBRA_INDEXER,
    deferMasterSeedSignature: args.deferMasterSeedSignature ?? true,
  });
}
