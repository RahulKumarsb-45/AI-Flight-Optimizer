-- ============================================================
-- AI FLIGHT OPTIMIZER - DATABASE SCHEMA
-- PostgreSQL, raw SQL, no ORM
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),              -- NULL if OAuth-only account
    auth_provider VARCHAR(20) NOT NULL DEFAULT 'local', -- local | google
    -- NOTE: GitHub OAuth has been permanently removed from this project. The
    -- column is left as an unconstrained VARCHAR (no CHECK) so any pre-existing
    -- 'github' rows remain valid without a destructive migration; new sign-ins
    -- can only be 'local' or 'google'.
    provider_id VARCHAR(255),                 -- OAuth provider's user id
    avatar_url TEXT,
    email_verified BOOLEAN NOT NULL DEFAULT false,
    email_verification_token VARCHAR(255),
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMPTZ,
    failed_login_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_provider ON users(auth_provider, provider_id);

-- ============================================================
-- SESSIONS (refresh tokens)
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,
    user_agent TEXT,
    ip_address VARCHAR(64),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
-- authService.js looks sessions up by refresh_token_hash on every token
-- refresh (`WHERE user_id = $1 AND refresh_token_hash = $2`) and on every
-- logout (`WHERE refresh_token_hash = $1`, no user_id at all — without this
-- index that query was a full table scan). refresh_token_hash values are
-- high-entropy (effectively unique), so a single-column index here serves
-- both call sites well without needing a composite index.
CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token_hash ON sessions(refresh_token_hash);

-- ============================================================
-- SUBSCRIPTIONS (pricing tiers)
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, -- one subscription row per user
    plan VARCHAR(20) NOT NULL DEFAULT 'free', -- free | pro | business
    billing_cycle VARCHAR(10) DEFAULT 'monthly', -- monthly | yearly
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- active | cancelled | expired | past_due
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    razorpay_subscription_id VARCHAR(255),
    razorpay_customer_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent: adds the UNIQUE constraint for databases that already ran an
-- earlier version of this schema without it (safe to re-run — no-ops if
-- the constraint already exists).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_user_id_key'
  ) THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_user_id_key UNIQUE (user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

-- ============================================================
-- PAYMENT TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    razorpay_payment_id VARCHAR(255),
    razorpay_order_id VARCHAR(255),
    amount_inr NUMERIC(10,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'created', -- created | success | failed | refunded
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payment_transactions(user_id);
-- paymentService.js looks up/updates transactions by razorpay_order_id on
-- every payment verification and Razorpay webhook call (some of these
-- queries filter by razorpay_order_id alone, with no user_id), and this
-- table had no index on that column at all before — a full table scan on
-- every webhook delivery.
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_order_id ON payment_transactions(razorpay_order_id);

-- ============================================================
-- AIRPORTS (static dataset, 215+ airports)
-- ============================================================
CREATE TABLE IF NOT EXISTS airports (
    id SERIAL PRIMARY KEY,
    iata_code VARCHAR(3) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    city VARCHAR(150) NOT NULL,
    country VARCHAR(150) NOT NULL,
    country_code VARCHAR(2) NOT NULL,
    region VARCHAR(100),
    latitude NUMERIC(9,6) NOT NULL,
    longitude NUMERIC(9,6) NOT NULL,
    timezone VARCHAR(64),
    rank_score INT NOT NULL DEFAULT 0  -- higher = more popular/major hub
);

CREATE INDEX IF NOT EXISTS idx_airports_iata ON airports(iata_code);
CREATE INDEX IF NOT EXISTS idx_airports_country ON airports(country_code);
CREATE INDEX IF NOT EXISTS idx_airports_city ON airports(city);

-- ============================================================
-- TRIPS (a planned/optimized trip)
-- ============================================================
CREATE TABLE IF NOT EXISTS trips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE, -- nullable: guest search
    origin_iata VARCHAR(3) NOT NULL,
    destination_countries TEXT[] NOT NULL,     -- e.g. {'GB','FR'}
    departure_date DATE,
    return_date DATE,
    date_flexible BOOLEAN NOT NULL DEFAULT false,
    travelers INT NOT NULL DEFAULT 1,
    budget_inr NUMERIC(12,2),
    preference VARCHAR(20) DEFAULT 'balanced', -- cheapest | fastest | balanced
    status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft | optimized | booked
    result_json JSONB,                          -- full optimizer output snapshot
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
-- tripController.listTrips runs `WHERE user_id = $1 ORDER BY created_at DESC
-- LIMIT 50` — this composite index lets Postgres satisfy both the filter
-- and the sort directly from the index (no separate sort step), instead of
-- using idx_trips_user alone and sorting the matching rows afterwards.
CREATE INDEX IF NOT EXISTS idx_trips_user_created_at ON trips(user_id, created_at DESC);

-- ============================================================
-- SAVED TRIPS (user bookmarks a trip result)
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_trips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, trip_id)
);

-- ============================================================
-- TRIP SHARES (public, non-guessable links onto an existing trip)
-- ============================================================
-- Deliberately a separate table/token from `trips.id`: the trip's own UUID
-- is never exposed as the public lookup key, so guessing or enumerating
-- trip ids can never expose another user's trip. `share_token` is a
-- high-entropy random string (see utils/tokens.js generateShareToken) and
-- is the ONLY way to reach a shared trip. Revoking a link is a soft-delete
-- (`revoked`) so history/analytics aren't lost and a link can't silently
-- come back to life.
CREATE TABLE IF NOT EXISTS trip_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- owner at time of sharing; used to authorize revoke
    share_token VARCHAR(64) UNIQUE NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT false,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_shares_token ON trip_shares(share_token);
CREATE INDEX IF NOT EXISTS idx_trip_shares_trip ON trip_shares(trip_id);

-- ============================================================
-- SEARCH HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS search_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    origin_iata VARCHAR(3) NOT NULL,
    destination_countries TEXT[] NOT NULL,
    search_params JSONB NOT NULL,
    result_count INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id);

-- ============================================================
-- FLIGHT CACHE (provider responses, TTL-based)
-- ============================================================
CREATE TABLE IF NOT EXISTS flight_cache (
    cache_key VARCHAR(500) PRIMARY KEY,   -- hash(origin,dest,date,passengers,provider)
    response_json JSONB NOT NULL,
    provider VARCHAR(20) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flight_cache_expires ON flight_cache(expires_at);

-- ============================================================
-- PRICE ALERTS
-- ============================================================
CREATE TABLE IF NOT EXISTS price_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    origin_iata VARCHAR(3) NOT NULL,
    destination_iata VARCHAR(3) NOT NULL,
    target_price_inr NUMERIC(10,2) NOT NULL,
    departure_date DATE,
    active BOOLEAN NOT NULL DEFAULT true,
    last_checked_price_inr NUMERIC(10,2),
    last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_user ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(active);

-- ============================================================
-- USER PREFERENCES (structured, used for AI personalization)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferred_airlines TEXT[],
    preferred_cabin VARCHAR(20) DEFAULT 'economy',
    budget_style VARCHAR(20) DEFAULT 'moderate', -- cheap | moderate | luxury
    travel_style VARCHAR(20),                     -- solo | couple | family | friends
    favorite_destinations TEXT[],
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- AI CHAT CONVERSATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- aiChatService.listConversations runs `WHERE user_id = $1 ORDER BY
-- updated_at DESC LIMIT 50` — this table had NO index on user_id at all
-- before, so that query was a full table scan. A composite index (matching
-- the trips(user_id, created_at DESC) pattern above) lets it satisfy both
-- the filter and the sort from the index directly.
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_updated_at ON ai_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role VARCHAR(10) NOT NULL, -- user | assistant
    content TEXT NOT NULL,
    structured_params JSONB,   -- parsed search parameters extracted from this message
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id);

-- ============================================================
-- updated_at auto-touch trigger
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_trips_updated_at ON trips;
CREATE TRIGGER trg_trips_updated_at BEFORE UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
