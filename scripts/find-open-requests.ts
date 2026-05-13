import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data, error } = await supabase
    .from("activity")
    .select("id,amount,message,receiver_address,created_at")
    .eq("type", "request")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) {
    console.log("No open requests found.");
    return;
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://swish.cash";
  data.forEach((r: any) => {
    const short = r.receiver_address
      ? `${r.receiver_address.slice(0, 4)}...${r.receiver_address.slice(-4)}`
      : "(no receiver)";
    console.log(
      `${r.amount} USDC | ${r.message || "(no message)"} | by ${short}`
    );
    console.log(`  ${baseUrl}/r/${r.id}`);
    console.log(`  created: ${r.created_at}`);
    console.log("");
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
