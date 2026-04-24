-- Migration: Add provider_id column to activity for multi-protocol aggregator
-- Existing rows are backfilled with 'privacy-cash' via the column default.
-- No CHECK constraint — app layer (lib/providers/registry.ts) validates known IDs
-- so new providers can be added without a schema migration.
ALTER TABLE activity ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'privacy-cash';
CREATE INDEX idx_activity_provider_id ON activity(provider_id);
