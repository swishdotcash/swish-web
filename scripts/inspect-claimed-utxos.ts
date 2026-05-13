/**
 * List rows in `umbra_claimed_utxos` for a wallet, newest first.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/inspect-claimed-utxos.ts <wallet>
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const wallet = process.argv[2];
  if (!wallet) {
    console.error("Usage: inspect-claimed-utxos.ts <wallet>");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_SECRET_KEY env vars"
    );
  }

  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("umbra_claimed_utxos")
    .select("*")
    .eq("wallet_address", wallet)
    .order("claimed_at", { ascending: false });

  if (error) throw error;

  console.log(
    `\nFound ${data?.length ?? 0} claimed UTXO record(s) for ${wallet}\n`
  );
  if (!data || data.length === 0) return;

  for (const row of data) {
    const ageMs = Date.now() - new Date(row.claimed_at).getTime();
    const ageMin = Math.floor(ageMs / 60000);
    const ageH = (ageMin / 60).toFixed(1);
    console.log(
      `  tree=${row.tree_index}  ins=${row.insertion_index}  ` +
        `claimed_at=${row.claimed_at}  (${ageMin}m / ${ageH}h ago)`
    );
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
