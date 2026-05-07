"use client";

/**
 * Custom IUmbraSigner adapter for Privy wallets.
 *
 * Replaces Umbra SDK's `createSignerFromWalletAccount` adapter, which
 * has a bug where the returned signed transaction uses the ORIGINAL
 * (pre-signing) messageBytes but the wallet's NEW signatures. If the
 * wallet modifies the tx during signing (which some wallets do for fee
 * payer adjustments / priority fees), the signature ends up valid for
 * the modified bytes but the SDK submits the original — failing
 * on-chain signature verification.
 *
 * Our adapter returns the FULLY DECODED signed transaction (modified
 * messageBytes + signatures), so the submitted tx is always what was
 * actually signed.
 *
 * See [Umbra pivot](memory/project_umbra_pivot_to_client_side.md).
 */

import {
  getTransactionDecoder,
  getTransactionEncoder,
} from "@solana/kit";
import {
  SolanaSignMessage,
  SolanaSignTransaction,
} from "@solana/wallet-standard-features";
import type { IUmbraSigner } from "@umbra-privacy/sdk/interfaces";

export function createUmbraSignerFromPrivyWallet(
  wallet: any, // wallet-standard Wallet (Privy's PrivyStandardWallet implements this)
  account: any // wallet-standard WalletAccount
): IUmbraSigner {
  const features = wallet.features;
  const signTx = features[SolanaSignTransaction];
  const signMsg = features[SolanaSignMessage];

  if (!signTx) {
    throw new Error(
      `Wallet "${wallet.name}" does not support solana:signTransaction`
    );
  }
  if (!signMsg) {
    throw new Error(
      `Wallet "${wallet.name}" does not support solana:signMessage`
    );
  }

  const encoder = getTransactionEncoder();
  const decoder = getTransactionDecoder();

  return {
    address: account.address,

    async signTransaction(transaction) {
      const wireBytes = encoder.encode(transaction);
      const [output] = await signTx.signTransaction({
        account,
        transaction: wireBytes,
      });
      // Take the actual signed bytes (in case Privy modified the tx
      // during signing — common for fee payer / priority fee
      // adjustments) but preserve the original kit metadata
      // (`lifetimeConstraint`, etc.) which doesn't survive wire
      // round-trip but is needed by the SDK for confirmation polling.
      const decoded = decoder.decode(output.signedTransaction);
      return {
        ...transaction,
        messageBytes: decoded.messageBytes,
        signatures: decoded.signatures,
      } as any;
    },

    async signTransactions(transactions) {
      const inputs = transactions.map((tx) => ({
        account,
        transaction: encoder.encode(tx),
      }));
      const outputs = await signTx.signTransaction(...inputs);
      return transactions.map((tx, i) => {
        const decoded = decoder.decode(outputs[i].signedTransaction);
        return {
          ...tx,
          messageBytes: decoded.messageBytes,
          signatures: decoded.signatures,
        } as any;
      });
    },

    async signMessage(message) {
      const [output] = await signMsg.signMessage({ account, message });
      return {
        message,
        signature: output.signature,
        signer: account.address,
      };
    },
  } as IUmbraSigner;
}
