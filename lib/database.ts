import { createClient } from "@supabase/supabase-js";
import { EncryptedPayload, PassphraseEncryptedPayload } from "./crypto";

// User types
export type ConnectionType = "wallet" | "x";

export interface User {
  id: string;
  wallet_address: string;
  connection_type: ConnectionType;
  twitter_handle: string | null;
  privy_user_id: string | null;
  created_at: number;
  updated_at: number;
}

// Activity types
export type ActivityType = "send" | "request" | "send_claim";

// Encrypted data can be either asymmetric (EncryptedPayload) or symmetric (PassphraseEncryptedPayload)
export type ClaimEncryptedData = EncryptedPayload | PassphraseEncryptedPayload;
export type ActivityStatus = "open" | "processing" | "settled" | "cancelled";

export interface Activity {
  id: string;
  type: ActivityType;
  sender_address: string;
  receiver_address: string | null;
  amount: number;
  token_address: string | null; // null for native SOL
  status: ActivityStatus;
  message: string | null;
  tx_hash: string | null;
  created_at: number;
  updated_at: number;
  // NULL while activity is open/processing/cancelled — set by the protocol
  // that actually settles the activity.
  provider_id: string | null;

  // send_claim-specific fields (optional, only for send_claim type)
  burner_address?: string | null;
  encrypted_for_receiver?: ClaimEncryptedData | null;
  encrypted_for_sender?: ClaimEncryptedData | null;
  deposit_tx_hash?: string | null;
  claim_tx_hash?: string | null;
}

// Supabase client (lazy-loaded to avoid build-time errors)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any = null;

function getSupabase() {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return supabase;
}

// Create activity. provider_id is NOT set here for `send` / `request` —
// it's stamped at settlement time by whichever protocol actually moved
// the money. For `send_claim` the privacy work happens at create
// (deposit + withdraw to burner), so callers may pass `provider_id`
// here and it lives on the row from the start; this lets the
// claim/reclaim routes dispatch to the right provider without trusting
// a body param from a different user.
export async function createActivity(
  activity: Omit<Activity, "id" | "created_at" | "updated_at" | "provider_id"> & {
    provider_id?: string | null;
  }
): Promise<Activity> {
  const now = Date.now();
  const id = crypto.randomUUID();

  const record: Activity = {
    provider_id: null,
    ...activity,
    id,
    created_at: now,
    updated_at: now,
  };

  // Remove undefined fields to avoid Supabase schema errors
  const cleanRecord = Object.fromEntries(
    Object.entries(record).filter(([_, v]) => v !== undefined)
  );

  const { error } = await getSupabase().from("activity").insert([cleanRecord]);

  if (error) {
    throw new Error(`Failed to create activity: ${error.message}`);
  }

  return record;
}

// Get activity by ID
export async function getActivity(id: string): Promise<Activity | null> {
  const { data, error } = await getSupabase()
    .from("activity")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    throw new Error(`Failed to get activity: ${error.message}`);
  }

  return data;
}

// Update activity status
export async function updateActivityStatus(
  id: string,
  status: ActivityStatus,
  updates?: Partial<
    Pick<
      Activity,
      | "tx_hash"
      | "claim_tx_hash"
      | "receiver_address"
      | "sender_address"
      | "provider_id"
      | "burner_address"
      | "encrypted_for_sender"
      | "encrypted_for_receiver"
      | "deposit_tx_hash"
    >
  >
): Promise<void> {
  const { error } = await getSupabase()
    .from("activity")
    .update({
      status,
      updated_at: Date.now(),
      ...updates,
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to update activity: ${error.message}`);
  }
}

// Atomically claim an activity by setting status to "processing" only if it's currently "open".
// Returns the activity if successfully claimed, null if already taken.
export async function claimActivity(id: string): Promise<Activity | null> {
  const { data, error } = await getSupabase()
    .from("activity")
    .update({
      status: "processing",
      updated_at: Date.now(),
    })
    .eq("id", id)
    .eq("status", "open")
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // No row matched — either doesn't exist or already claimed
      return null;
    }
    throw new Error(`Failed to claim activity: ${error.message}`);
  }

  return data;
}

// Get all activities for a user
export async function getActivitiesForUser(
  userAddress: string
): Promise<Activity[]> {
  const { data, error } = await getSupabase()
    .from("activity")
    .select("*")
    .or(`sender_address.eq.${userAddress},receiver_address.eq.${userAddress}`)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to get activities: ${error.message}`);
  }

  return data || [];
}

// Get user stats (computed from activity)
export async function getUserStats(userAddress: string): Promise<{
  sent_direct: number;
  sent_claim: number;
  total_sent: number;
  total_received: number;
  total_requested: number;
  total_claimed: number;
}> {
  // Get all settled activities where user is sender
  const { data: sentData, error: sentError } = await getSupabase()
    .from("activity")
    .select("amount, type")
    .eq("sender_address", userAddress)
    .eq("status", "settled");

  if (sentError) {
    throw new Error(`Failed to get sent stats: ${sentError.message}`);
  }

  // Get all settled activities where user is receiver
  const { data: receivedData, error: receivedError } = await getSupabase()
    .from("activity")
    .select("amount, type")
    .eq("receiver_address", userAddress)
    .eq("status", "settled");

  if (receivedError) {
    throw new Error(`Failed to get received stats: ${receivedError.message}`);
  }

  const sent_direct = (sentData || [])
    .filter((a: Activity) => a.type === "send")
    .reduce((sum: number, a: Activity) => sum + a.amount, 0);

  const sent_claim = (sentData || [])
    .filter((a: Activity) => a.type === "send_claim")
    .reduce((sum: number, a: Activity) => sum + a.amount, 0);

  const total_received = (receivedData || [])
    .filter((a: Activity) => a.type === "send")
    .reduce((sum: number, a: Activity) => sum + a.amount, 0);

  const total_requested = (receivedData || [])
    .filter((a: Activity) => a.type === "request")
    .reduce((sum: number, a: Activity) => sum + a.amount, 0);

  const total_claimed = (receivedData || [])
    .filter((a: Activity) => a.type === "send_claim")
    .reduce((sum: number, a: Activity) => sum + a.amount, 0);

  return {
    sent_direct,
    sent_claim,
    total_sent: sent_direct + sent_claim,
    total_received,
    total_requested,
    total_claimed,
  };
}

// --- User operations ---

// Upsert user (insert or update on wallet_address conflict)
export async function upsertUser(data: {
  wallet_address: string;
  connection_type: ConnectionType;
  twitter_handle?: string | null;
  privy_user_id?: string | null;
}): Promise<User> {
  const now = Date.now();
  const { data: result, error } = await getSupabase()
    .from("users")
    .upsert(
      {
        wallet_address: data.wallet_address,
        connection_type: data.connection_type,
        twitter_handle: data.twitter_handle || null,
        privy_user_id: data.privy_user_id || null,
        updated_at: now,
      },
      { onConflict: "wallet_address" }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to upsert user: ${error.message}`);
  }

  return result;
}

// Get user by wallet address
export async function getUserByWallet(address: string): Promise<User | null> {
  const { data, error } = await getSupabase()
    .from("users")
    .select("*")
    .eq("wallet_address", address)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Failed to get user by wallet: ${error.message}`);
  }

  return data;
}

// Get user by Twitter handle
export async function getUserByTwitterHandle(handle: string): Promise<User | null> {
  const { data, error } = await getSupabase()
    .from("users")
    .select("*")
    .eq("twitter_handle", handle)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Failed to get user by twitter handle: ${error.message}`);
  }

  return data;
}

// --- Twitter ID cache operations ---

export interface TwitterIdCache {
  twitter_handle: string;
  twitter_numeric_id: string;
  created_at: number;
}

// Look up cached Twitter numeric ID by handle
export async function getTwitterIdByHandle(handle: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from("twitter_id_cache")
    .select("twitter_numeric_id")
    .eq("twitter_handle", handle.toLowerCase())
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Failed to get twitter ID cache: ${error.message}`);
  }

  return data?.twitter_numeric_id ?? null;
}

// Store a handle → numeric ID mapping in cache
export async function cacheTwitterId(handle: string, numericId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("twitter_id_cache")
    .upsert(
      {
        twitter_handle: handle.toLowerCase(),
        twitter_numeric_id: numericId,
        created_at: Date.now(),
      },
      { onConflict: "twitter_handle" }
    );

  if (error) {
    throw new Error(`Failed to cache twitter ID: ${error.message}`);
  }
}

// Get user by Privy user ID
export async function getUserByPrivyId(privyId: string): Promise<User | null> {
  const { data, error } = await getSupabase()
    .from("users")
    .select("*")
    .eq("privy_user_id", privyId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Failed to get user by privy ID: ${error.message}`);
  }

  return data;
}

// ============================================================
// Umbra claimed-UTXO tracker
// ============================================================
//
// Filters phantom (nullified) UTXOs that Umbra's scanner returns
// alongside genuine unclaimed ones. See:
// memory/project_umbra_claimed_utxo_tracker.md

export interface UmbraUtxoRef {
  treeIndex: number;
  insertionIndex: number;
}

/**
 * Returns the set of claimed UTXO IDs (`"treeIdx:insertionIdx"`) for a
 * wallet. Used by the client to filter scanner output before display.
 */
export async function getClaimedUmbraUtxoIds(
  walletAddress: string
): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from("umbra_claimed_utxos")
    .select("tree_index, insertion_index")
    .eq("wallet_address", walletAddress);

  if (error) {
    throw new Error(`Failed to fetch claimed UTXOs: ${error.message}`);
  }
  return (data ?? []).map(
    (row: { tree_index: number; insertion_index: number }) =>
      `${row.tree_index}:${row.insertion_index}`
  );
}

/**
 * Bulk-mark a list of UTXOs as claimed for the given wallet. Idempotent:
 * duplicate `(wallet, tree_index, insertion_index)` rows are silently
 * ignored via the primary key.
 */
export async function markUmbraUtxosClaimed(
  walletAddress: string,
  utxos: readonly UmbraUtxoRef[]
): Promise<void> {
  if (utxos.length === 0) return;

  const rows = utxos.map((u) => ({
    wallet_address: walletAddress,
    tree_index: u.treeIndex,
    insertion_index: u.insertionIndex,
    claimed_at: new Date().toISOString(),
  }));

  const { error } = await getSupabase()
    .from("umbra_claimed_utxos")
    .upsert(rows, {
      onConflict: "wallet_address,tree_index,insertion_index",
      ignoreDuplicates: true,
    });

  if (error) {
    throw new Error(`Failed to mark UTXOs claimed: ${error.message}`);
  }
}
