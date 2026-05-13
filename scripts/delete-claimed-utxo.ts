/**
 * Manual recovery: delete a row from `umbra_claimed_utxos`.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/delete-claimed-utxo.ts \
 *     <wallet> <tree_index> <insertion_index>
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const [wallet, treeStr, insStr] = process.argv.slice(2);
  if (!wallet || treeStr === undefined || insStr === undefined) {
    console.error(
      "Usage: delete-claimed-utxo.ts <wallet> <tree_index> <insertion_index>"
    );
    process.exit(1);
  }
  const treeIndex = Number(treeStr);
  const insertionIndex = Number(insStr);
  if (Number.isNaN(treeIndex) || Number.isNaN(insertionIndex)) {
    throw new Error("tree_index and insertion_index must be numbers");
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY env vars");
  }

  const supabase = createClient(url, key);

  const { data: pre } = await supabase
    .from("umbra_claimed_utxos")
    .select("*")
    .eq("wallet_address", wallet)
    .eq("tree_index", treeIndex)
    .eq("insertion_index", insertionIndex);

  if (!pre || pre.length === 0) {
    console.log(
      `No row found for (${wallet}, tree=${treeIndex}, ins=${insertionIndex}). Nothing to delete.`
    );
    return;
  }

  console.log("About to delete:");
  for (const row of pre) console.log(" ", row);

  const { error } = await supabase
    .from("umbra_claimed_utxos")
    .delete()
    .eq("wallet_address", wallet)
    .eq("tree_index", treeIndex)
    .eq("insertion_index", insertionIndex);

  if (error) throw error;
  console.log("\nDeleted.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
