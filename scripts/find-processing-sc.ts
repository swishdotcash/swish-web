import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data, error } = await supabase
    .from("activity")
    .select("id, type, sender_address, amount, status, provider_id, burner_address, deposit_tx_hash, claim_tx_hash, created_at, updated_at")
    .eq("type", "send_claim")
    .eq("status", "processing")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) {
    console.log("No processing send_claim rows.");
    return;
  }
  for (const row of data) {
    const ageS = Math.floor((Date.now() - new Date(row.created_at).getTime()) / 1000);
    console.log(`---`);
    console.log(`id: ${row.id}`);
    console.log(`age: ${ageS}s   provider: ${row.provider_id}   amount: ${row.amount}`);
    console.log(`sender: ${row.sender_address}`);
    console.log(`burner: ${row.burner_address ?? "(none)"}`);
    console.log(`deposit_tx: ${row.deposit_tx_hash ?? "(none)"}`);
    console.log(`claim_tx: ${row.claim_tx_hash ?? "(none)"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
