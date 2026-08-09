-- Réglages supplémentaires par organisation (voir SettingsView.jsx) :
-- salon Discord et nombre de posts pris en compte par plateforme.
-- cron_schedule/timezone/notif_daily/notif_warnings existent déjà depuis
-- 003_viewtracker_bot.sql.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS discord_channel_id text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS posts_limit integer;
