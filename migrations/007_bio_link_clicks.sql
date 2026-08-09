-- Lien en bio trackable par compte suivi, voir src/bioLink.js — un lien
-- court (bio_link_slug) que l'utilisateur colle dans sa bio Instagram/
-- TikTok/YouTube à la place de son lien réel (bio_link_url), qui
-- redirige (GET /r/:slug, voir server.js) tout en comptant les clics.
ALTER TABLE creators ADD COLUMN IF NOT EXISTS bio_link_url text;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS bio_link_slug text UNIQUE;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS bio_link_clicks integer NOT NULL DEFAULT 0;
