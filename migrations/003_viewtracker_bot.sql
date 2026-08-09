-- Étend le schéma existant de creator_leaderboard pour y brancher le bot
-- ViewTracker (voir /Users/.../.claude/plans/foamy-hatching-trinket.md,
-- section "Principe : étendre, ne pas dupliquer") — additive uniquement,
-- aucun DROP ni ALTER TYPE sur l'existant. N'importe rien : les
-- organisations de démo ("Studio Clip", "Test") et leurs tracked_accounts
-- ne sont pas affectées par cette migration.

-- Config bot par organisation (résolution du "tenant" par défaut, voir
-- src/org.js) — colonnes absentes du schéma d'origine.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS discord_guild_id text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS discord_owner_id text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cron_schedule text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS notif_daily boolean NOT NULL DEFAULT true;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS notif_warnings boolean NOT NULL DEFAULT true;

-- Le schéma existant n'a aucune notion de "créateur" regroupant plusieurs
-- plateformes — le bot additionne IG+TT+YT d'une même personne en un seul
-- total (voir src/instagram.js#buildViewsSummary), d'où cette table.
CREATE TABLE IF NOT EXISTS creators (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

-- Nullable : les tracked_accounts de démo existants restent non groupés,
-- sans impact sur leur fonctionnement actuel.
ALTER TABLE tracked_accounts ADD COLUMN IF NOT EXISTS creator_id bigint REFERENCES creators(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tracked_accounts_creator ON tracked_accounts(creator_id);

-- Équivalent DB de data/cumulative-views.json : cumul "all time" par
-- créateur, mis à jour de façon incrémentale (voir
-- cumulativeViews.js#updateCumulativeViews, logique pure inchangée).
CREATE TABLE IF NOT EXISTS creator_cumulative_views (
  creator_id bigint PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
  total bigint NOT NULL DEFAULT 0,
  ig bigint NOT NULL DEFAULT 0,
  tt bigint NOT NULL DEFAULT 0,
  yt bigint NOT NULL DEFAULT 0,
  last_updated date
);

-- Équivalent DB de data/last-message.json : IDs des messages Discord
-- édités plutôt que renvoyés à chaque collecte (voir
-- scanCycle.js#sendOrEditSummary).
CREATE TABLE IF NOT EXISTS last_messages (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  channel_id text NOT NULL,
  message_id text NOT NULL,
  PRIMARY KEY (organization_id, key)
);
