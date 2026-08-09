-- Journal des clics sur les liens en bio (voir src/bioLink.js) — un clic
-- brut incrémentait déjà creators.bio_link_clicks (compteur, migration
-- 007), mais ne gardait pas trace du "quand" : impossible de tracer un
-- graphique d'évolution des clics dans le temps sans ça.
CREATE TABLE IF NOT EXISTS bio_link_click_events (
  id bigserial PRIMARY KEY,
  creator_id bigint NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  clicked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bio_link_click_events_creator_date ON bio_link_click_events (creator_id, clicked_at);
