-- Activity table for all payment operations (send, request, send_claim)
CREATE TABLE activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('send', 'request', 'send_claim')),
  sender_address TEXT NOT NULL,
  receiver_address TEXT,
  amount NUMERIC NOT NULL,
  token_address TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'cancelled')),
  message TEXT,
  tx_hash TEXT,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,

  -- send_claim-specific fields (null for send/request)
  burner_address TEXT,
  encrypted_for_receiver JSONB,
  encrypted_for_sender JSONB,
  deposit_tx_hash TEXT,
  claim_tx_hash TEXT,

  -- Privacy protocol that actually settled this activity (privacy-cash, magicblock-per, umbra).
  -- NULL while open/processing — stamped at settle time by whichever protocol moved the money.
  provider_id TEXT
);

-- Indexes for common queries
CREATE INDEX idx_activity_sender_address ON activity(sender_address);
CREATE INDEX idx_activity_receiver_address ON activity(receiver_address);
CREATE INDEX idx_activity_status ON activity(status);
CREATE INDEX idx_activity_created_at ON activity(created_at DESC);
CREATE INDEX idx_activity_updated_at ON activity(updated_at DESC);
CREATE INDEX idx_activity_amount ON activity(amount);
CREATE INDEX idx_activity_token_address ON activity(token_address);

-- Composite indexes for stats queries
CREATE INDEX idx_activity_sender_status ON activity(sender_address, status);
CREATE INDEX idx_activity_receiver_status ON activity(receiver_address, status);
CREATE INDEX idx_activity_provider_id ON activity(provider_id);

-- Enable Row Level Security
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read
CREATE POLICY "Allow public read" ON activity
  FOR SELECT
  USING (true);

-- Policy: Only service role can insert/update/delete
CREATE POLICY "Service role full access" ON activity
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL UNIQUE,
  connection_type TEXT NOT NULL CHECK (connection_type IN ('wallet', 'x')),
  twitter_handle TEXT,
  privy_user_id TEXT,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

CREATE UNIQUE INDEX idx_users_twitter_handle ON users(twitter_handle) WHERE twitter_handle IS NOT NULL;
CREATE INDEX idx_users_privy_user_id ON users(privy_user_id);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON users
  FOR SELECT
  USING (true);

CREATE POLICY "Service role full access" ON users
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Twitter ID cache (handle → numeric ID mapping)
CREATE TABLE twitter_id_cache (
  twitter_handle TEXT PRIMARY KEY,
  twitter_numeric_id TEXT NOT NULL,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

ALTER TABLE twitter_id_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON twitter_id_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
