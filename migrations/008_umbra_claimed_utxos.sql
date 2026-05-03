-- 008_umbra_claimed_utxos.sql
--
-- Per-UTXO tracking of claimed Umbra leaves.
--
-- Umbra's getClaimableUtxoScannerFunction returns nullified (already-
-- claimed) UTXOs alongside genuine unclaimed ones. Until they ship their
-- official plugin (per Umbra DM 2026-05-01), Swish maintains its own
-- record of which UTXOs each wallet has claimed, so we can filter out
-- phantoms from the displayed shielded balance and from the Unlock flow.
--
-- Cleanup expected when Umbra's plugin ships (~30 min, see
-- project_umbra_claimed_utxo_tracker.md).

CREATE TABLE IF NOT EXISTS umbra_claimed_utxos (
  wallet_address TEXT NOT NULL,
  tree_index INTEGER NOT NULL,
  insertion_index INTEGER NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wallet_address, tree_index, insertion_index)
);

CREATE INDEX IF NOT EXISTS idx_umbra_claimed_wallet
  ON umbra_claimed_utxos (wallet_address);

-- Enable RLS. Access goes exclusively through Swish's API routes using
-- the service role key (which bypasses RLS by design); we want anon/
-- public keys locked out so direct PostgREST traffic can't read or
-- write this table from a browser. Leaving the table with RLS on and
-- no policies enforces "service role only" access.
ALTER TABLE umbra_claimed_utxos ENABLE ROW LEVEL SECURITY;
