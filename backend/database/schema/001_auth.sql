CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS auth_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  role VARCHAR(20) NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id VARCHAR(100) PRIMARY KEY,
  display_name VARCHAR(120) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash CHAR(64) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  client_id VARCHAR(100) NOT NULL REFERENCES oauth_clients(client_id) ON DELETE RESTRICT,
  code_challenge VARCHAR(128) NOT NULL,
  code_challenge_method VARCHAR(10) NOT NULL CHECK (code_challenge_method = 'S256'),
  remember_access BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  client_id VARCHAR(100) NOT NULL REFERENCES oauth_clients(client_id) ON DELETE RESTRICT,
  token_family_id UUID NOT NULL,
  persistent BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revocation_reason VARCHAR(40) CHECK (
    revocation_reason IS NULL OR revocation_reason IN ('LOGOUT', 'REFRESH_TOKEN_REUSE', 'EXPIRED')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  parent_token_id UUID REFERENCES auth_refresh_tokens(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth_users(id) ON DELETE SET NULL,
  session_id UUID REFERENCES auth_sessions(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL,
  ip_address INET,
  user_agent VARCHAR(500),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_authorization_codes_expires_at
  ON oauth_authorization_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_family_id ON auth_sessions(token_family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session_id ON auth_refresh_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON auth_refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_security_events_user_created
  ON auth_security_events(user_id, created_at DESC);

INSERT INTO oauth_clients (client_id, display_name)
VALUES ('crm-web', 'HealthCRM Web')
ON CONFLICT (client_id) DO NOTHING;
