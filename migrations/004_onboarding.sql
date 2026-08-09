-- Onboarding obligatoire pour les organisations créées via l'inscription
-- publique (voir src/auth.js#signupUser) : au moins un compte à suivre
-- avant d'accéder au dashboard. Défaut à `true` pour ne pas redemander
-- l'onboarding aux organisations déjà existantes (créées avant cette
-- migration, ou via scripts/create-user.js) — seul signupUser insère
-- explicitement `false`.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT true;
