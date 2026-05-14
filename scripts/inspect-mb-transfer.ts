/**
 * Decode the unsigned transaction MagicBlock's /v1/spl/transfer returns,
 * to see exactly what instructions (and fee transfers) it contains.
 *
 * Usage:
 *   npx tsx scripts/inspect-mb-transfer.ts <fromPubkey> <toPubkey> [amountBaseUnits]
 *
 * Builds the transfer three ways — no exactOut, exactOut:false,
 * exactOut:true — and diffs the decoded instructions so we can see what,
 * if anything, that flag actually changes.
 */

import { VersionedTransaction } from "@solana/web3.js";

const MB_URL = "https://payments.magicblock.app/v1/spl/transfer";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const [from, to, amountArg] = process.argv.slice(2);
if (!from || !to) {
  console.error(
    "usage: npx tsx scripts/inspect-mb-transfer.ts <from> <to> [amountBaseUnits]"
  );
  process.exit(1);
}
const amount = Number(amountArg ?? 1_000_000); // default 1 USDC

async function build(exactOut: boolean | undefined) {
  const body: Record<string, unknown> = {
    from,
    to,
    mint: USDC_MINT,
    amount,
    visibility: "private",
    fromBalance: "base",
    toBalance: "base",
    initAtasIfMissing: true,
  };
  if (exactOut !== undefined) body.exactOut = exactOut;

  const res = await fetch(MB_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    console.log(`  [exactOut=${exactOut}] API error:`, JSON.stringify(json));
    return null;
  }
  return json as { transactionBase64: string; instructionCount: number };
}

function decodeAmount(data: Uint8Array): string {
  // SPL transfer / transferChecked: byte 0 = instruction tag (3 or 12),
  // bytes 1..9 = u64 LE amount.
  if (data.length < 9) return "(no amount)";
  let amt = BigInt(0);
  for (let i = 8; i >= 1; i--) amt = (amt << BigInt(8)) | BigInt(data[i]);
  return amt.toString();
}

function describe(txB64: string) {
  // Raw decode — no LUT resolution. Static keys cover the program IDs and
  // signer/payer; LUT-sourced accounts show as "lut#<index>". Enough to
  // spot fee transfers and their amounts.
  const tx = VersionedTransaction.deserialize(Buffer.from(txB64, "base64"));
  const msg: any = tx.message;
  const staticKeys: any[] = msg.staticAccountKeys ?? [];
  const numStatic = staticKeys.length;
  const keyName = (idx: number) =>
    idx < numStatic ? staticKeys[idx].toBase58() : `lut#${idx - numStatic}`;

  const lines: string[] = [];
  const ixs: any[] = msg.compiledInstructions ?? [];
  ixs.forEach((ix, i) => {
    const pid = keyName(ix.programIdIndex);
    const data: Uint8Array = ix.data;
    let tag = pid;
    if (pid === TOKEN_PROGRAM || pid === TOKEN_2022_PROGRAM) {
      const insTag = data[0];
      const kind =
        insTag === 3
          ? "transfer"
          : insTag === 12
          ? "transferChecked"
          : `tag${insTag}`;
      tag = `SPL-Token ${kind} amount=${decodeAmount(data)}`;
    }
    const accts = (ix.accountKeyIndexes ?? [])
      .map((idx: number) => keyName(idx))
      .join(", ");
    lines.push(`  [${i}] ${tag}\n      accounts: ${accts}`);
  });
  return lines.join("\n");
}

(async () => {
  for (const variant of [undefined, false, true] as const) {
    console.log(`\n=== exactOut = ${variant} ===`);
    const result = await build(variant);
    if (!result) continue;
    console.log(`  instructionCount: ${result.instructionCount}`);
    console.log(describe(result.transactionBase64));
  }
})();
