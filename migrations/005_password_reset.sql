-- Réinitialisation de mot de passe par email (voir src/auth.js,
-- src/email.js). Seul le hash du token est stocké — le token brut ne
-- transite que dans l'email envoyé, jamais en base (même en cas de fuite
-- de la table, aucun token exploitable n'y est présent).
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);
