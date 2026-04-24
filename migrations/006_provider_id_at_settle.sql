-- Migration: provider_id is now stamped at settlement, not creation.
-- Rationale: the protocol that actually moves money (at settle time) is the
-- honest owner of this field. Before settlement, the protocol is undecided
-- (for Requests) or just intended (for Sends/Send-Claims).
--
-- Drop NOT NULL + DEFAULT so open activities can have NULL provider_id.
-- Historical settled rows keep 'privacy-cash' (accurate — they were all PC).
ALTER TABLE activity ALTER COLUMN provider_id DROP NOT NULL;
ALTER TABLE activity ALTER COLUMN provider_id DROP DEFAULT;

-- Clear provider_id on rows that never settled. Their old 'privacy-cash'
-- stamp was a meaningless placeholder from PR #19's default.
UPDATE activity SET provider_id = NULL
WHERE status IN ('open', 'processing', 'cancelled');
