"use client";

/**
 * Browser smoke test for Umbra SDK + useUmbraSend hook.
 *
 * Two test surfaces:
 *   1. SDK smoke test — verifies the Umbra SDK + WASM prover load and
 *      run a read query in the browser. No funds at stake.
 *   2. Umbra send test — actually triggers a direct Send via the new
 *      useUmbraSend hook. Default recipient is the test wallet that's
 *      already registered on Umbra. STAKES SMALL USDC.
 *
 * Throwaway — delete after Phase 2 lands.
 */

import { useState } from "react";
import { Keypair } from "@solana/web3.js";
import { useUmbraSend } from "@/hooks/useUmbraSend";
import { useUmbraRegister } from "@/hooks/useUmbraRegister";

interface StageResult {
  stage: string;
  status: "pending" | "running" | "ok" | "error";
  ms?: number;
  detail?: string;
}

const TEST_REGISTERED_ADDRESS = "B5avcLKaBhRB7vy2dQyU5281mNXaqL3ksvE7pwDBd5nu";

export default function UmbraSmokeTestPage() {
  const [stages, setStages] = useState<StageResult[]>([
    { stage: "Import SDK", status: "pending" },
    { stage: "Construct prover suite (WASM)", status: "pending" },
    { stage: "Construct Umbra client (browser)", status: "pending" },
    { stage: "Query registered address", status: "pending" },
    { stage: "Query unregistered address", status: "pending" },
  ]);
  const [running, setRunning] = useState(false);

  const updateStage = (idx: number, patch: Partial<StageResult>) => {
    setStages((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    );
  };

  const runSmokeTest = async () => {
    setRunning(true);
    setStages((prev) =>
      prev.map((s) => ({ ...s, status: "pending", ms: undefined, detail: undefined }))
    );

    const tStart = Date.now();
    try {
      // Stage 0: Import SDK (this is also the bundle test)
      updateStage(0, { status: "running" });
      const t0 = Date.now();
      const sdk = await import("@umbra-privacy/sdk");
      const prover = await import("@umbra-privacy/web-zk-prover");
      updateStage(0, {
        status: "ok",
        ms: Date.now() - t0,
        detail: `Loaded ${Object.keys(sdk).length} sdk exports + ${Object.keys(prover).length} prover exports`,
      });

      // Stage 1: Construct prover suite (this exercises WASM loading)
      updateStage(1, { status: "running" });
      const t1 = Date.now();
      const assetProvider = prover.getCdnZkAssetProvider();
      const deps = { assetProvider };
      const suite = {
        registration: prover.getUserRegistrationProver(deps),
        utxoSelfClaimable:
          prover.getCreateSelfClaimableUtxoFromPublicBalanceProver(deps),
        utxoReceiverClaimable:
          prover.getCreateReceiverClaimableUtxoFromPublicBalanceProver(deps),
        claimSelfClaimableIntoEncryptedBalance:
          prover.getClaimSelfClaimableUtxoIntoEncryptedBalanceProver(deps),
        claimReceiverClaimableIntoEncryptedBalance:
          prover.getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver(deps),
        claimSelfClaimableIntoPublicBalance:
          prover.getClaimSelfClaimableUtxoIntoPublicBalanceProver(deps),
      };
      updateStage(1, {
        status: "ok",
        ms: Date.now() - t1,
        detail: `${Object.keys(suite).length} provers constructed`,
      });

      // Stage 2: Construct Umbra client (browser-side)
      updateStage(2, { status: "running" });
      const t2 = Date.now();
      const throwaway = Keypair.generate();
      const signer = await sdk.createSignerFromPrivateKeyBytes(
        throwaway.secretKey
      );
      const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
      if (!rpcUrl) throw new Error("NEXT_PUBLIC_RPC_URL not set");
      const wsUrl = rpcUrl.replace(/^https?:\/\//, "wss://");
      const client = await sdk.getUmbraClient({
        signer,
        network: "mainnet",
        rpcUrl,
        rpcSubscriptionsUrl: wsUrl,
        indexerApiEndpoint: "https://indexer.umbraprivacy.com",
        deferMasterSeedSignature: true,
      });
      updateStage(2, {
        status: "ok",
        ms: Date.now() - t2,
        detail: `Client constructed; signer address: ${signer.address.slice(0, 8)}...`,
      });

      // Stage 3: Query a known-registered address
      updateStage(3, { status: "running" });
      const t3 = Date.now();
      const query = sdk.getUserAccountQuerierFunction({ client });
      const knownResult = await query(TEST_REGISTERED_ADDRESS as any);
      updateStage(3, {
        status: "ok",
        ms: Date.now() - t3,
        detail: `state: ${knownResult.state}`,
      });

      // Stage 4: Query a fresh unregistered address (the throwaway we generated)
      updateStage(4, { status: "running" });
      const t4 = Date.now();
      const unknownResult = await query(throwaway.publicKey.toBase58() as any);
      updateStage(4, {
        status: "ok",
        ms: Date.now() - t4,
        detail: `state: ${unknownResult.state}`,
      });
    } catch (err: any) {
      const failingIdx = stages.findIndex((s) => s.status === "running");
      if (failingIdx >= 0) {
        updateStage(failingIdx, {
          status: "error",
          detail: err?.message ?? String(err),
        });
      }
      console.error("Smoke test failed:", err);
    } finally {
      setRunning(false);
      console.log(`Total elapsed: ${Date.now() - tStart}ms`);
    }
  };

  // === Umbra registration ===
  const { register, state: registerState } = useUmbraRegister();

  // === Real Umbra send test ===
  const [recipient, setRecipient] = useState(TEST_REGISTERED_ADDRESS);
  const [amount, setAmount] = useState("0.05");
  const { send, state: sendState } = useUmbraSend();
  const [sendResult, setSendResult] = useState<{
    activityId: string | null;
    createUtxoSignature: string;
    createProofAccountSignature: string;
  } | null>(null);

  const runSendTest = async () => {
    setSendResult(null);
    try {
      const baseUnits = BigInt(Math.floor(parseFloat(amount) * 1_000_000));
      const result = await send({
        receiverAddress: recipient,
        amountBaseUnits: baseUnits,
      });
      setSendResult({
        activityId: result.activityId,
        createUtxoSignature: result.createUtxoSignature,
        createProofAccountSignature: result.createProofAccountSignature,
      });
    } catch (err) {
      // useUmbraSend already updates state on error; nothing to do here
    }
  };

  return (
    <div className="min-h-screen bg-[#fafafa] p-8">
      <div className="max-w-2xl mx-auto space-y-12">
        <section>
          <h1 className="text-2xl font-semibold text-[#121212] mb-4">
            Umbra browser SDK smoke test
          </h1>
          <p className="text-sm text-[#121212]/70 mb-6">
            Validates @umbra-privacy/sdk + @umbra-privacy/web-zk-prover load and
            run in the Next.js browser bundle. No funds at stake.
          </p>

          <button
            onClick={runSmokeTest}
            disabled={running}
            className="h-10 px-6 rounded-full bg-[#121212] text-[#fafafa] font-medium disabled:opacity-50 mb-6"
          >
            {running ? "Running…" : "Run smoke test"}
          </button>

          <div className="space-y-2">
            {stages.map((s, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 p-3 rounded-lg border ${
                  s.status === "ok"
                    ? "border-green-200 bg-green-50"
                    : s.status === "error"
                      ? "border-red-200 bg-red-50"
                      : s.status === "running"
                        ? "border-blue-200 bg-blue-50"
                        : "border-[#121212]/10"
                }`}
              >
                <div className="w-6 text-lg shrink-0">
                  {s.status === "ok"
                    ? "✓"
                    : s.status === "error"
                      ? "✗"
                      : s.status === "running"
                        ? "…"
                        : "○"}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-[#121212]">{s.stage}</div>
                  {s.ms !== undefined && (
                    <div className="text-xs text-[#121212]/50">{s.ms}ms</div>
                  )}
                  {s.detail && (
                    <div className="text-xs text-[#121212]/70 mt-1 font-mono break-all">
                      {s.detail}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-[#121212]/10 pt-12">
          <h2 className="text-2xl font-semibold text-[#121212] mb-4">
            Register on Umbra (one-time)
          </h2>
          <p className="text-sm text-[#121212]/70 mb-6">
            Required before sending. Idempotent — calling on an already-
            registered wallet is a no-op. 1-3 wallet prompts. User pays SOL
            for tx fees + PDA rent (~0.005-0.01 SOL).
          </p>

          <button
            onClick={() => register().catch(() => {})}
            disabled={
              registerState.stage === "checking" ||
              registerState.stage === "registering"
            }
            className="h-10 px-6 rounded-full bg-[#121212] text-[#fafafa] font-medium disabled:opacity-50 mb-4"
          >
            {registerState.stage === "checking" ||
            registerState.stage === "registering"
              ? `Working… (${registerState.stage})`
              : "Register me on Umbra"}
          </button>

          <div className="text-sm text-[#121212]/70 mb-2">
            Stage: <span className="font-mono">{registerState.stage}</span>
          </div>
          {registerState.detail && (
            <div className="text-xs text-[#121212]/60 font-mono break-all mb-2">
              {registerState.detail}
            </div>
          )}
          {registerState.error && (
            <pre className="text-xs text-red-700 p-3 rounded-lg border border-red-200 bg-red-50 mb-4 whitespace-pre-wrap break-all font-mono">
              {registerState.error}
            </pre>
          )}
          {registerState.txSignatures.length > 0 && (
            <div className="text-xs text-green-700 p-3 rounded-lg border border-green-200 bg-green-50 break-all font-mono space-y-1">
              {registerState.txSignatures.map((s, i) => (
                <div key={i}>tx {i + 1}: {s}</div>
              ))}
            </div>
          )}
        </section>

        <section className="border-t border-[#121212]/10 pt-12">
          <h2 className="text-2xl font-semibold text-[#121212] mb-4">
            Test Umbra direct Send
          </h2>
          <p className="text-sm text-[#121212]/70 mb-6">
            Triggers a real on-chain Umbra send via useUmbraSend. Stakes USDC.
            Default recipient is the test wallet pre-registered on Umbra.
            Expect ~3 wallet prompts (consent + 2 deposit txs).
          </p>

          <div className="space-y-3 mb-4">
            <div>
              <label className="text-sm text-[#121212]/50 block mb-1">
                Recipient (must be Umbra-registered)
              </label>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#121212]/10 bg-white text-[#121212] outline-none font-mono text-sm"
              />
            </div>
            <div>
              <label className="text-sm text-[#121212]/50 block mb-1">
                Amount (USDC)
              </label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#121212]/10 bg-white text-[#121212] outline-none"
              />
            </div>
          </div>

          <button
            onClick={runSendTest}
            disabled={sendState.stage !== "idle" && sendState.stage !== "settled" && sendState.stage !== "error"}
            className="h-10 px-6 rounded-full bg-[#121212] text-[#fafafa] font-medium disabled:opacity-50 mb-4"
          >
            {sendState.stage === "idle" || sendState.stage === "settled" || sendState.stage === "error"
              ? "Run send test"
              : `Working… (${sendState.stage})`}
          </button>

          <div className="text-sm text-[#121212]/70 mb-2">
            Stage: <span className="font-mono">{sendState.stage}</span>
          </div>
          {sendState.detail && (
            <div className="text-xs text-[#121212]/60 font-mono break-all mb-2">
              {sendState.detail}
            </div>
          )}
          {sendState.error && (
            <pre className="text-xs text-red-700 p-3 rounded-lg border border-red-200 bg-red-50 mb-4 whitespace-pre-wrap break-all font-mono">
              {sendState.error}
            </pre>
          )}

          {sendResult && (
            <div className="text-sm text-green-700 p-3 rounded-lg border border-green-200 bg-green-50 break-all space-y-1">
              <div>✓ Sent successfully</div>
              <div className="font-mono text-xs">
                createUtxo: {sendResult.createUtxoSignature}
              </div>
              <div className="font-mono text-xs">
                createProofAccount: {sendResult.createProofAccountSignature}
              </div>
              {sendResult.activityId && (
                <div className="font-mono text-xs">
                  activityId: {sendResult.activityId}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
