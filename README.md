# Bot Discord — Résumé des vues (Instagram / TikTok / YouTube)

Bot Discord qui scrape les dernières publications (Reels/vidéos) d'une liste
de comptes sur Instagram, TikTok et YouTube, additionne leurs vues, et
affiche un classement automatiquement chaque jour dans un salon Discord.

⚠️ **Comment ça marche** : le bot ne passe par aucune API officielle pour
Instagram/YouTube. Le scraping de ces deux plateformes est délégué à
**`scraper-service`**, un microservice Python séparé basé sur
[Scrapling](https://github.com/D4Vinci/Scrapling) (voir section 0 ci-dessous)
qui charge directement les pages publiques des comptes et lit les compteurs
de vues affichés à l'écran — Scrapling relocalise automatiquement ses
sélecteurs quand Instagram/YouTube changent la structure de leurs pages
("adaptive scraping"), ce qui limite (sans l'éliminer) le risque de casse
silencieuse propre à cette approche. TikTok, lui, passe par une API tierce
(`tiktokapi.store`, voir `src/instagram.js`), Playwright y ayant été
abandonné après blocage systématique par captcha. Un usage intensif présente
un risque de blocage/rate-limit du compte utilisé pour la session Instagram.

## 0. Le microservice de scraping (`scraper-service`)

Instagram et YouTube sont scrapés par un service Python séparé
(`scraper-service/`), appelé en HTTP par le bot Node — voir
`src/scraperClient.js`. Le bot Node lui-même n'utilise plus Playwright que
pour l'export manuel des cookies Instagram (`src/login.js`,
`scripts/export-ig-cookies.js`).

**En local :**

```bash
cd scraper-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
scrapling install   # installe les navigateurs nécessaires à Scrapling
uvicorn main:app --reload --port 8000
```

Le bot Node (section 5) doit alors avoir `SCRAPER_SERVICE_URL=http://localhost:8000`
dans son `.env` (c'est la valeur par défaut si la variable est absente).

**En production (Railway ou autre)** : `scraper-service` se déploie comme un
service à part (il a son propre `Dockerfile`), non exposé publiquement —
seul le bot Node lui parle. Définissez `SCRAPER_SERVICE_TOKEN` (une valeur
secrète de votre choix) côté `scraper-service` **et** côté bot Node, pour
que le service refuse les appels non authentifiés.

## 0bis. Base de données (Postgres)

Le bot ne stocke plus rien dans `data/*.json` : comptes suivis, historique
des collectes, cumul all-time et derniers messages Discord édités sont
persistés dans une base Postgres **partagée** avec un autre projet
(`creator_leaderboard`) — pas une base dédiée à créer de zéro. Le schéma
d'origine (organisations, comptes suivis, snapshots...) est étendu de
façon additive par `migrations/003_viewtracker_bot.sql` (nouvelle table
`creators` pour regrouper les comptes multi-plateformes, colonnes de
config bot sur `organizations`, `creator_cumulative_views`,
`last_messages`) — voir les commentaires en tête de ce fichier de
migration pour le détail. Ces migrations s'appliquent automatiquement au
démarrage (`src/db.js#runMigrations`, appelé par `src/index.js`/
`src/scan.js`/`scripts/run-once.js`) : rien à lancer manuellement.

Le bot reste mono-tenant pour l'instant : une seule organisation Postgres
("Mon Serveur") est utilisée, résolue une fois au démarrage à partir de
`DISCORD_GUILD_ID` (voir `src/org.js`) — pas encore de session
utilisateur pour choisir l'organisation (prévu avec le futur système de
comptes, voir section 0ter).

**Variable requise** : `DATABASE_URL` (chaîne de connexion Postgres
standard, ex. `postgres://user@localhost:5432/creator_leaderboard` en
local, fournie par Railway en production).

**Première mise en route** : si vous partez de `data/*.json` existants
(migration depuis une version antérieure du bot), importez-les une fois
dans Postgres avec :

```bash
npm run migrate:import-json
```

Idempotent (upserts) — peut être relancé sans dupliquer les données.

## 0ter. Le dashboard web

Le bot expose aussi un dashboard web (dossier `web/`, React + Vite), servi
par un serveur Express intégré au même process que le bot
(`src/server.js`, démarré par `src/index.js`). Il permet de visualiser le
classement, l'historique et la liste des comptes suivis — sur les mêmes
données Postgres que celles utilisées pour Discord (voir section 0bis).
Pas de bouton "Lancer un scan" : la collecte reste pilotée uniquement par
le cron planifié (ou `npm run scan`/`npm run run-once` en CLI).

**En local :**

```bash
npm run build:web        # build unique du frontend (web/dist)
npm start                # sert le dashboard sur http://localhost:3000 (PORT)
```

Pour itérer sur l'UI avec rechargement à chaud, lancez en parallèle :

```bash
npm start                # API + bot Discord, sur PORT (3000 par défaut)
npm run dev:web           # serveur Vite avec proxy /api → localhost:3000
```

**Variable d'env spécifique au dashboard** (voir aussi section 3) :
- `PORT` (optionnel, défaut `3000`) : port du serveur Express.

**Comptes ajoutés depuis le dashboard** : persistés en base (table
`creators`/`tracked_accounts`, voir section 0bis) — au premier démarrage,
`ACCOUNTS` du `.env` sert de seed initial (`src/accountsStore.js`), mais à
partir de là c'est la base qui fait foi, pas `ACCOUNTS`. **Réglages de
notification** (résumé quotidien / alertes de scraping) : persistés sur
`organizations.notif_daily`/`notif_warnings`, lus par `src/scanCycle.js` à
chaque collecte cron.

## 0quater. Auth & connexion

Le dashboard n'a plus de mot de passe unique partagé : chaque utilisateur
a son propre compte (email + mot de passe), branché sur les tables
`users`/`memberships` déjà présentes dans `creator_leaderboard`. Une
`membership` relie un utilisateur à une organisation avec un rôle
(`owner`/`manager`/`clipper`/`viewer`) — au login, le dashboard utilise
directement la première organisation du membership de l'utilisateur (pas
de sélecteur d'organisation pour l'instant, un seul cas réel — "Mon
Serveur" — existe aujourd'hui).

**Deux façons de créer un compte** :

1. **Inscription publique** (bouton "Pas de compte ? En créer un" sur
   l'écran de login, `POST /api/signup`, voir `src/auth.js#signupUser`) —
   crée l'utilisateur **et** une organisation neuve et vide dont il est
   `owner`. Jamais d'accès direct à "Mon Serveur" (les vraies données) par
   ce chemin : chaque inscription obtient son propre tenant isolé.
   Redirige ensuite vers un **onboarding obligatoire**
   (`OnboardingScreen.jsx`) qui demande d'ajouter au moins un compte de
   clippeur à suivre avant de débloquer le dashboard (`organizations.
   onboarding_completed`, voir `migrations/004_onboarding.sql` — pas de
   choix de "mode scraping/API" à cette étape, le bot reste scraping-only).
2. **Script CLI de bootstrap**, pour t'attacher toi-même à l'organisation
   par défaut du bot ("Mon Serveur") plutôt qu'en créer une nouvelle :
   ```bash
   npm run create-user -- vous@exemple.fr votre-mot-de-passe
   # ou, pour ne pas laisser le mot de passe dans l'historique du shell :
   CREATE_USER_PASSWORD=votre-mot-de-passe npm run create-user -- vous@exemple.fr
   ```
   (`scripts/create-user.js`) — crée l'utilisateur (ou met à jour son mot
   de passe s'il existe déjà) et l'attache comme `owner` à l'organisation
   par défaut (voir `src/org.js`) s'il n'y est pas déjà ; aucun onboarding
   à faire dans ce cas (organisation déjà configurée).

Mots de passe hachés avec `crypto.scrypt` (natif Node, pas de dépendance
`bcrypt`/`argon2`) — voir `src/passwords.js`. Mot de passe minimum 8
caractères à l'inscription.

Les sessions sont des cookies signés (HMAC), avec un secret régénéré à
chaque démarrage du process : se reconnecter après un redéploiement est
normal, pas un bug.

**Mot de passe oublié** (`POST /api/forgot-password` + `POST
/api/reset-password`, voir `src/auth.js`, `src/email.js`) : envoie un
email via [Resend](https://resend.com) avec un lien à usage unique
(`migrations/005_password_reset.sql`, expire après 1h). Variables d'env :

- `RESEND_API_KEY` (**requis pour que l'envoi fonctionne réellement** —
  sans elle, la demande reste silencieuse côté utilisateur mais l'erreur
  est loguée côté serveur, voir `src/email.js`).
- `RESEND_FROM` (optionnel, défaut `onboarding@resend.dev` — adresse de
  test Resend sans vérification de domaine ; à remplacer par une adresse
  d'un domaine vérifié dans Resend en production).
- `PUBLIC_URL` (optionnel, défaut `http://localhost:$PORT`) : sert à
  construire le lien dans l'email (`{PUBLIC_URL}/?resetToken=...`) — à
  définir sur l'URL publique réelle en production (ex. Railway).

Réponse volontairement identique que l'email existe ou non côté
`/api/forgot-password`, pour ne pas révéler quels emails ont un compte.

**Déploiement (Railway)** : le dashboard tourne dans le même service que le
bot (voir section 6) — le `Dockerfile` build `web/` avant de démarrer le
bot (`npm run build:web`, voir Dockerfile). Rendez le port du service
public dans Railway pour accéder au dashboard depuis un navigateur.

## 0quinquies. Réglages disponibles dans le dashboard (Paramètres)

- **Apparence** : thème clair/sombre — préférence stockée en local
  (`localStorage`, voir `web/src/theme.js`), pas encore par organisation
  côté serveur. Toutes les couleurs sont pilotées par variables CSS
  (`web/src/theme.css`, `[data-theme="light"]`) ; la sidebar reste sombre
  dans les deux thèmes (choix volontaire).
- **Mot de passe** : changer le sien (mot de passe actuel requis).
- **Organisation** : renommer l'organisation (réservé aux rôles
  `owner`/`manager`).
- **Publier sur Discord** (switch, renommé depuis "Résumé quotidien") :
  active/désactive l'envoi du classement — la collecte a toujours lieu,
  seule la publication est concernée.
- **Diffusion Discord & collecte** — salons Discord (**plusieurs IDs
  possibles**, un par ligne ou séparés par une virgule — le classement est
  posté/édité indépendamment dans chacun, voir
  `scanCycle.js#parseChannelIds`), heure d'envoi (cron), fuseau horaire,
  nombre de posts pris en compte par plateforme : éditables et
  **réellement pris en compte**, mais seulement pour l'organisation par
  défaut du bot ("Mon Serveur", résolue via `DISCORD_GUILD_ID`, voir
  `src/org.js`) — c'est la seule organisation dont le cron
  (`src/scheduler.js`) parle réellement à Discord aujourd'hui. Changer
  l'heure/le fuseau reprogramme le job en direct, sans redémarrer le
  process (`rescheduleIfDefaultOrg`).
- **Comptes suivis** : suppression et édition (renommer, changer les
  URLs) directement depuis la vue Comptes, en plus de l'ajout déjà
  existant.

⚠️ Pas d'écran "Membres & invitations" dans le dashboard (retiré — faisait
doublon avec "Ajouter un compte" aux yeux de l'utilisateur). Les routes
serveur restent disponibles pour un usage API direct :
`GET/POST /api/members`, `POST /api/members/invite`,
`DELETE /api/members/:id`, `POST /api/invitations/accept` (voir
`src/auth.js#inviteMember`/`listMembers`/`removeMember`/`acceptInvitation`).

## 1. Prérequis côté Discord

1. Créez une application sur le
   [Discord Developer Portal](https://discord.com/developers/applications).
2. Onglet **Bot** > créez le bot > copiez le **Token**
   (`DISCORD_TOKEN`).
3. Toujours sur l'onglet **Bot**, notez que seule l'intent `Guilds` est
   nécessaire (déjà celle utilisée par défaut dans `src/index.js`).
4. Onglet **OAuth2 > URL Generator** : cochez `bot`, puis les permissions
   `Send Messages` et `Embed Links`. Ouvrez l'URL générée pour inviter le bot
   sur votre serveur.
5. Sur la page **General Information** de l'app, copiez l'**Application ID**
   (`DISCORD_CLIENT_ID`).
6. Activez le mode développeur Discord (Paramètres > Avancés) pour pouvoir
   faire un clic droit et copier les identifiants :
   - clic droit sur le **nom du serveur** > Copier l'identifiant du serveur
     (`DISCORD_GUILD_ID`, facultatif mais recommandé — voir section 4)
   - clic droit sur le **salon cible** > Copier l'identifiant du salon
     (`DISCORD_CHANNEL_ID`, utilisé pour l'envoi automatique quotidien)

## 2. Prérequis côté Instagram (session de scraping)

Instagram n'affiche pas toutes les infos à un visiteur non connecté. Il faut
donc fournir au bot une session Instagram valide, sous forme de cookies.

1. Installez les navigateurs Playwright si ce n'est pas déjà fait :
   ```bash
   npx playwright install chromium
   ```
2. Lancez le script de connexion manuelle :
   ```bash
   node src/login.js
   ```
3. Une fenêtre de navigateur s'ouvre sur la page de connexion Instagram.
   Connectez-vous normalement (idéalement avec un compte dédié, pas votre
   compte personnel) dans les 60 secondes.
4. Le script sauvegarde automatiquement les cookies de session dans
   `src/ig-cookies.json`. Ce fichier est lu par `src/instagram.js` à chaque
   scraping — tant qu'il est présent et que la session n'a pas expiré, vous
   n'avez pas besoin de refaire cette étape.
5. Si le scraping Instagram recommence à échouer après un moment (session
   expirée), relancez simplement `node src/login.js`.

TikTok et YouTube n'ont besoin d'aucune session : leurs pages publiques
suffisent (YouTube a juste besoin d'un cookie de consentement générique,
déjà géré automatiquement dans `src/instagram.js`).

### Fournir les cookies via une variable d'environnement (hébergement sans volume)

Sur un hébergeur dont le système de fichiers n'est pas persistant (Railway
sans volume monté, par exemple), `src/ig-cookies.json` disparaît à chaque
redéploiement. Dans ce cas, fournissez son contenu directement via la
variable d'environnement `IG_COOKIES_JSON` (prioritaire sur le fichier,
voir `src/instagram.js`) :

```bash
npm run export-ig-cookies
```

Ce script (`scripts/export-ig-cookies.js`) ouvre un navigateur, vous laisse
vous connecter manuellement à Instagram, puis exporte les cookies vers
`src/ig-cookies.json`. Copiez ensuite tout le contenu de ce fichier dans la
variable `IG_COOKIES_JSON` de votre hébergeur.

## 3. Installation

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Remplissez le fichier `.env` :

- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`,
  `DISCORD_CHANNEL_ID` (voir section 1)
- `ACCOUNTS` : la liste des comptes à suivre, au format JSON — un objet par
  compte avec un `name` (affiché dans le classement) et un tableau `urls`
  (liens Instagram / TikTok / YouTube du compte). Exemple déjà présent dans
  `.env.example` :
  ```json
  [{"name":"mon_compte","urls":["https://www.instagram.com/xxx/","https://www.tiktok.com/@xxx","https://www.youtube.com/@xxx"]}]
  ```
  Vous pouvez lister plusieurs comptes dans le tableau, et pour chaque
  compte ne fournir que les plateformes qui vous intéressent (les urls
  absentes comptent simplement pour 0 vue).

  `.env.example` contient déjà **20 emplacements placeholder**
  (`nom_du_compte_1` à `nom_du_compte_20`, avec des URLs `url_ig_N`/`url_tt_N`/
  `url_yt_N`). Remplacez-les progressivement par les vrais comptes au fur et
  à mesure que vous les avez — tant qu'une entrée garde ses URLs
  placeholder, elle apparaîtra avec 0 vue et un ⚠️ dans Discord (comportement
  normal, pas un bug : voir la section sur les échecs de scraping ci-dessous).
- `CRON_SCHEDULE` (optionnel, défaut `0 9 * * *` = tous les jours à 9h) et
  `TIMEZONE` (optionnel, défaut `Europe/Paris`) : réglages de l'envoi
  automatique quotidien.
- `SCRAPER_SERVICE_URL` (optionnel, défaut `http://localhost:8000`) et
  `SCRAPER_SERVICE_TOKEN` (optionnel en local, fortement recommandé en
  production) : voir section 0, doivent pointer vers votre instance de
  `scraper-service` et partager le même token que celui configuré côté
  service.
- `DATABASE_URL` (**obligatoire**) : voir section 0bis, connexion à la
  base Postgres partagée.
- `PORT` (optionnel, défaut `3000`) : voir section 0ter, port du serveur
  Express du dashboard web. Voir aussi section 0quater (`npm run
  create-user`) pour créer un compte de connexion.

## 4. Forcer une collecte immédiate

Avant la première exécution du cron, ou pour tester sans attendre l'heure
planifiée, vous pouvez lancer une collecte manuelle indépendamment de
Discord :

```bash
npm run scan
```

Ça scrape tous les comptes de `ACCOUNTS` et affiche le résultat dans le
terminal.

Pour un test rapide sans attendre les délais volontaires anti-détection
(3-8 secondes entre chaque requête), utilisez `FAST_MODE=1 npm run scan`.
**À ne jamais utiliser en production** : le rythme de requêtes redevient
alors facilement détectable comme automatisé.

## 5. Lancer le bot

```bash
npm start
```

Au démarrage, le bot se connecte à Discord et planifie l'envoi automatique
du résumé dans `DISCORD_CHANNEL_ID` selon `CRON_SCHEDULE`/`TIMEZONE` (log de
confirmation dans la console).

## 6. Déploiement en continu (Railway)

Le bot inclut un `Dockerfile` (basé sur l'image officielle Playwright, encore
nécessaire pour `src/login.js`/`scripts/export-ig-cookies.js`) et tourne
actuellement sur [Railway](https://railway.app), qui le détecte et le build
automatiquement. `scraper-service` (voir section 0) se déploie comme un
**second service séparé** dans le même projet Railway, avec son propre
`Dockerfile` (`scraper-service/Dockerfile`).

1. **New Project → Deploy from GitHub repo**, sélectionnez le repo. Railway
   crée un service pour le bot Node ; ajoutez ensuite un second service
   (**New → GitHub repo**, même repo, en réglant son *root directory* sur
   `scraper-service/`) pour `scraper-service`.
2. **Variables du service bot** : renseignez toutes les variables de la
   section 3 (`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`,
   `DISCORD_CHANNEL_ID`, `ACCOUNTS`, `CRON_SCHEDULE`, `TIMEZONE`,
   `SCRAPER_SERVICE_URL`, `SCRAPER_SERVICE_TOKEN`, `DATABASE_URL`), plus
   `IG_COOKIES_JSON` (voir section 2) puisque Railway ne fournit pas de
   volume par défaut pour `src/ig-cookies.json`. Une fois déployé, créez
   au moins un compte de connexion avec `npm run create-user` (voir
   section 0quater) — depuis votre poste, avec `DATABASE_URL` pointé sur
   la même base qu'en production.
   `SCRAPER_SERVICE_URL` doit pointer vers l'URL interne Railway du
   service `scraper-service` (`http://<nom-du-service>.railway.internal:8000`,
   réseau privé — pas besoin d'exposer ce service publiquement).
   `DATABASE_URL` doit pointer vers la base Postgres `creator_leaderboard`
   (déjà hébergée quelque part si elle sert aussi à un autre projet — pas
   un addon Postgres Railway séparé, sauf si vous migrez cette base sur
   Railway). Contrairement à `scraper-service`, **le service bot doit lui
   être exposé publiquement** (Railway → Settings → Networking → Generate
   Domain) pour accéder au dashboard web (voir section 0ter) depuis un
   navigateur.
3. **Variables du service `scraper-service`** : `SCRAPER_SERVICE_TOKEN`
   (même valeur que côté bot).
4. Railway redéploie automatiquement à chaque push sur la branche connectée.
   ⚠️ Ce déclenchement automatique s'est montré peu fiable en pratique (le
   webhook ne se déclenche pas toujours) — en cas de doute après un push,
   forcez un déploiement manuel :
   ```bash
   railway redeploy --from-source
   ```

Sur un autre hébergeur (VPS, Render, Raspberry Pi...), tournez plutôt avec
un gestionnaire de process comme `pm2` :

```bash
npm install -g pm2
pm2 start src/index.js --name ig-discord-bot
pm2 save
```

⚠️ Le fichier `src/ig-cookies.json` (ou la variable `IG_COOKIES_JSON`) doit
être disponible sur la machine d'hébergement. Sur un système de fichiers non
persistant, pensez à régénérer les cookies après chaque redéploiement si la
session a expiré.

### Limite mémoire

Le service bot Node ne pilote plus de navigateur pour le scraping en direct
(seulement pour l'export ponctuel des cookies IG), sa consommation mémoire
est donc redevenue légère. Le navigateur reste utilisé côté
`scraper-service` (Scrapling) — un plan d'hébergement modeste (ex. 1 Go sur
le plan gratuit Railway) peut ne pas suffire à ce service en cas de scan
avec beaucoup de comptes ; ajustez la RAM allouée à `scraper-service`
spécifiquement si des crashs apparaissent en plein scan.

## Notes

- `src/embed.js` centralise la construction du message (`buildLeaderboardEmbed`),
  utilisée pour l'envoi automatique quotidien.
- Le nombre de posts pris en compte par compte est actuellement fixé à 5
  (variable `IG_POSTS_LIMIT`, transmise à `scraper-service` par requête —
  voir `src/config.js` et `src/scraperClient.js`). Sur Instagram, les reels
  **épinglés** sont ignorés dans ce calcul (ils ne reflètent pas l'activité
  récente) — détectés via le badge `svg[aria-label="Pinned post icon"]` sur
  chaque vignette, logique portée dans
  `scraper-service/scraping/instagram.py`.
- Utilisez de préférence un compte Instagram dédié au scraping plutôt que
  votre compte personnel, pour limiter les conséquences en cas de
  restriction temporaire par Instagram.
- Les pages publiques d'Instagram/YouTube changent régulièrement de
  structure ; Scrapling relocalise automatiquement ses sélecteurs dans la
  plupart des cas ("adaptive scraping", voir section 0), mais si le
  scraping d'une plateforme se met à retourner 0 vue systématiquement, la
  logique de secours (fallbacks) est probablement devenue obsolète et doit
  être mise à jour dans `scraper-service/scraping/instagram.py` ou
  `youtube.py`. TikTok passe par `tiktokapi.store` (`TIKTOK_API_KEY`), sans
  scraping de page.
