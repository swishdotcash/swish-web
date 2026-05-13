import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const id = process.argv[2];
  if (!id) {
    throw new Error("Usage: tsx scripts/inspect-activity.ts <activity-id>");
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data, error } = await supabase.from("activity").select("*").eq("id", id).single();
  if (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
