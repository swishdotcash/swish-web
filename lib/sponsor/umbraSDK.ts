/**
 * Server-side Umbra SDK helpers.
 *
 * - `getUmbraProverSuite` constructs the IZkProverSuite from web-zk-prover
 *   factory functions, with circuit assets fetched from Umbra's CDN.
 * - `createUmbraSignerFromKeypair` adapts a web3.js Keypair to IUmbraSigner
 *   for the burner-pattern flows where Swish controls the keys.
 * - `getServerUmbraClient` is the entry point — wraps `getUmbraClient` with
 *   our RPC + indexer config and the prover suite.
 *
 * See [Umbra research](memory/project_protocol_umbra.md) and
 * [Unified balance vision](memory/project_unified_balance_vision.md).
 */

import { Keypair } from "@solana/web3.js";
import {
  createSignerFromPrivateKeyBytes,
  getUmbraClient,
} from "@umbra-privacy/sdk";
import type {
  IUmbraClient,
  IUmbraSigner,
  IZkProverForReceiverClaimableUtxo,
  IZkProverForSelfClaimableUtxo,
  IZkProverSuite,
} from "@umbra-privacy/sdk/interfaces";
import type { Network } from "@umbra-privacy/sdk/constants";
import {
  getCdnZkAssetProvider,
  getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver,
  getClaimSelfClaimableUtxoIntoEncryptedBalanceProver,
  getClaimSelfClaimableUtxoIntoPublicBalanceProver,
  getCreateReceiverClaimableUtxoFromPublicBalanceProver,
  getCreateSelfClaimableUtxoFromPublicBalanceProver,
  getUserRegistrationProver,
} from "@umbra-privacy/web-zk-prover";

const UMBRA_NETWORK: Network = "mainnet";
const UMBRA_INDEXER = "https://utxo-indexer.api.umbraprivacy.com";

function getRpcUrl(): string {
  const url = process.env.RPC_URL;
  if (!url) {
    throw new Error("RPC_URL not configured");
  }
  return url;
}

// Most providers serve the WS endpoint at the same host with `wss://`. Override
// via `RPC_WSS_URL` if a provider needs a different host.
function getRpcSubscriptionsUrl(): string {
  const explicit = process.env.RPC_WSS_URL;
  if (explicit) return explicit;
  return getRpcUrl().replace(/^https?:\/\//, "wss://");
}

// Cache the suite — circuit asset providers can be reused across requests, no
// per-request state.
let cachedSuite: IZkProverSuite | null = null;

export function getUmbraProverSuite(): IZkProverSuite {
  if (cachedSuite) return cachedSuite;

  const assetProvider = getCdnZkAssetProvider();
  const deps = { assetProvider };

  // The suite slots want the broader parent prover types (which handle both
  // FromPublic and FromEncrypted inputs). The FromPublicBalance factories
  // return narrower subtypes — TS rejects them. v1 only ever calls the
  // public-balance side, so casting is safe at runtime; v2 (spend-from-
  // shielded) will need to swap these for combined provers that handle both
  // input shapes.
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

// web3.js Keypair `secretKey` is 64 bytes (32-byte seed + 32-byte pubkey),
// which `createSignerFromPrivateKeyBytes` accepts directly.
export async function createUmbraSignerFromKeypair(
  keypair: Keypair
): Promise<IUmbraSigner> {
  return createSignerFromPrivateKeyBytes(keypair.secretKey);
}

interface ServerUmbraClientArgs {
  signer: IUmbraSigner;
  // Default `true`: master seed derivation is lazy. The signer's `signMessage`
  // is invoked at most once across the client's lifetime, when a service
  // function actually needs a derived key. Burner flows want this lazy because
  // we may not need every key immediately.
  deferMasterSeedSignature?: boolean;
}

export async function getServerUmbraClient(
  args: ServerUmbraClientArgs
): Promise<IUmbraClient> {
  return getUmbraClient({
    signer: args.signer,
    network: UMBRA_NETWORK,
    rpcUrl: getRpcUrl(),
    rpcSubscriptionsUrl: getRpcSubscriptionsUrl(),
    indexerApiEndpoint: UMBRA_INDEXER,
    deferMasterSeedSignature: args.deferMasterSeedSignature ?? true,
  });
}
