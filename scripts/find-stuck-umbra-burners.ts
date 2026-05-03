/**
 * Find activity rows by burner_address.
 *
 * Use when you know a burner address (e.g. from a tx in Solscan) but not
 * the activity ID, and need to run recover-stuck-umbra-send.ts on it.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/find-stuck-umbra-burners.ts \
 *     <burnerAddr1> [<burnerAddr2> ...]
 *
 * Prints: activityId | status | amount | sender | has_encrypted_for_sender
 */

import { createClient } from "@supabase/supabase-js";

async function main() {
  const burners = process.argv.slice(2);
  if (burners.length === 0) {
    console.error("Usage: find-stuck-umbra-burners.ts <burner1> [<burner2> ...]");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase env vars (SUPABASE_URL + SUPABASE_SECRET_KEY)"
    );
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from("activity")
    .select(
      "id, burner_address, status, amount, sender_address, created_at, encrypted_for_sender, provider_id, type"
    )
    .in("burner_address", burners);

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log("No activity rows found for those burner addresses.");
    return;
  }

  for (const row of data) {
    const ciphertext = (row.encrypted_for_sender as any)?.ciphertext;
    console.log("─".repeat(60));
    console.log(`activityId:        ${row.id}`);
    console.log(`burner_address:    ${row.burner_address}`);
    console.log(`type:              ${row.type}`);
    console.log(`provider_id:       ${row.provider_id}`);
    console.log(`status:            ${row.status}`);
    console.log(`amount:            ${row.amount} USDC`);
    console.log(`sender_address:    ${row.sender_address}`);
    console.log(`created_at:        ${new Date(row.created_at).toISOString()}`);
    console.log(`has ciphertext:    ${ciphertext ? "yes" : "NO — recovery may fail"}`);
  }
  console.log("─".repeat(60));
  console.log(
    `\nFound ${data.length} row(s). To recover each:\n  npx tsx --env-file=.env scripts/recover-stuck-umbra-send.ts <activityId>\n`
  );
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
