# Bot Discord — Suivi des vues (Instagram / TikTok / YouTube)

Bot Discord qui suit les dernières publications (Reels/vidéos/Shorts) d'une
liste de comptes sur Instagram, TikTok et YouTube, et publie automatiquement
chaque jour dans un salon Discord deux classements indépendants :

- **🔥 Dernières 24h** — les vues gagnées depuis la veille, calculées vidéo
  par vidéo (pas juste un delta de total brut, voir plus bas).
- **♾️ All time** — le cumul de tous les gains journaliers depuis le début
  du suivi.

Les deux messages sont **édités en place** chaque jour (jamais de nouveau
message envoyé), et les échecs de scraping ne polluent pas le salon public :
ils partent en MP à un admin désigné (voir `DISCORD_OWNER_ID`).

## Comment ça marche, plateforme par plateforme

- **Instagram** : navigateur headless (Playwright + plugin stealth) avec une
  session connectée (cookies), qui charge l'onglet Reels du profil et lit
  les compteurs de vues affichés à l'écran. Fragile par nature : si
  Instagram change la structure de ses pages, ou si la session tombe sur
  l'écran de consentement publicitaire européen ("pay or consent", voir
  plus bas), le scraping peut échouer sans prévenir.
- **TikTok** : passe par l'API tierce [tiktokapi.store](https://tiktokapi.store)
  plutôt que par un navigateur. TikTok bloque désormais Playwright derrière
  un captcha slider infranchissable (testé le 08/08/2026 avec IP
  résidentielle, navigateur non-headless et patchs anti-détection CDP —
  aucune piste n'a fonctionné), d'où ce choix.
- **YouTube** : navigateur headless comme Instagram, mais sans session (les
  Shorts d'une chaîne sont publics) — juste un cookie de consentement
  générique injecté automatiquement.

### Pourquoi le classement 24h ne compte pas juste "hier vs aujourd'hui"

Le bot ne suit que les `IG_POSTS_LIMIT` publications les plus récentes par
compte et par plateforme (2 par défaut). Avec une fenêtre aussi étroite, dès
qu'un compte publie, une ancienne vidéo (qui avait eu le temps d'accumuler
des vues) sort du suivi et se fait remplacer par une vidéo neuve (encore à 0
vue). Comparer les totaux bruts d'un jour à l'autre confondrait donc "vidéo
qui sort de la fenêtre" et "vraie perte de vues".

Le scraping capture donc un **identifiant par vidéo** en plus du total (href
du reel/short, `video_id` de l'API TikTok), stocké dans l'historique. Le
calcul du gain 24h (`src/history.js#computeGrowth24h`) compare alors les
vidéos individuellement : une vidéo déjà vue hier ne compte que sa vraie
progression, une vidéo neuve apporte ses vues telles quelles. Repli
automatique sur l'ancien calcul par total brut si l'ID n'a pas pu être
extrait (repli texte sans lien fiable, ou entrée d'historique antérieure à
cette fonctionnalité).

### "Ban" et ⚠️ dans les classements

- **`Ban`** : la plateforme n'est pas configurée pour ce compte (URL vide
  dans `ACCOUNTS`) — rien n'a été tenté, ce n'est pas un échec.
- **⚠️** : il y a eu un vrai échec de scraping sur cette plateforme pour ce
  compte, ce jour-là (exception, timeout, sélecteurs obsolètes...). Un `0`
  sans erreur enregistrée (stagnation réelle — même vidéo, même total qu'hier)
  s'affiche tel quel, sans avertissement.

## 1. Prérequis côté Discord

1. Créez une application sur le
   [Discord Developer Portal](https://discord.com/developers/applications).
2. Onglet **Bot** > créez le bot > copiez le **Token** (`DISCORD_TOKEN`).
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
     (`DISCORD_GUILD_ID`, facultatif)
   - clic droit sur le **salon cible** > Copier l'identifiant du salon
     (`DISCORD_CHANNEL_ID`, utilisé pour l'envoi automatique quotidien)
   - clic droit sur **votre propre profil** > Copier l'identifiant
     utilisateur (`DISCORD_OWNER_ID`, pour recevoir les alertes et backups
     en MP — le bot doit partager un serveur avec vous pour pouvoir vous
     écrire)

## 2. Prérequis côté Instagram (session de scraping)

Instagram n'affiche pas toutes les infos à un visiteur non connecté. Il faut
donc fournir au bot une session Instagram valide, sous forme de cookies.

1. Installez les navigateurs Playwright si ce n'est pas déjà fait :
   ```bash
   npx playwright install chromium
   ```
2. Lancez le script d'export :
   ```bash
   npm run export-ig-cookies
   ```
3. Une fenêtre de navigateur s'ouvre sur la page de connexion Instagram.
   Connectez-vous normalement (idéalement avec un compte dédié, pas votre
   compte personnel).
4. **Naviguez ensuite manuellement vers le profil d'un des comptes suivis**
   (ex. `instagram.com/un_compte/reels/`). Instagram peut rediriger vers un
   écran de consentement publicitaire européen ("Voulez-vous vous abonner ou
   continuer à utiliser nos produits sans paiement avec des publicités ?") —
   validez votre choix (l'option gratuite "Utiliser sans paiement avec des
   publicités" convient si vous ne voulez pas payer l'abonnement). Tant que
   ce choix n'est pas validé une fois, la session redirige vers cet écran à
   chaque navigation, ce qui fait échouer *tous* les comptes IG d'un coup
   (vécu le 10/08/2026 — voir la détection dédiée dans `src/instagram.js`,
   qui lève un message d'erreur explicite si ça se reproduit).
5. Une fois le profil/les reels affichés normalement, créez le fichier
   signal pour que le script continue et exporte les cookies :
   ```bash
   touch scripts/.ig-login-done
   ```
6. Les cookies sont sauvegardés dans `src/ig-cookies.json`. Ce fichier est lu
   par `src/instagram.js` à chaque scraping — tant qu'il est présent et que
   la session n'a pas expiré, vous n'avez pas besoin de refaire cette étape.
7. Si le scraping Instagram recommence à échouer après un moment (session
   expirée, ou nouvel écran de consentement), relancez simplement
   `npm run export-ig-cookies`.

TikTok n'a besoin d'aucune session (voir section 3 pour la clé API). YouTube
n'a besoin d'aucune session non plus, juste d'un cookie de consentement
générique déjà géré automatiquement.

### Fournir les cookies via une variable d'environnement (hébergement sans volume)

Sur un hébergeur dont le système de fichiers n'est pas persistant,
`src/ig-cookies.json` disparaît à chaque redéploiement. Copiez alors tout le
contenu de ce fichier dans la variable d'environnement `IG_COOKIES_JSON`
(prioritaire sur le fichier, voir `src/instagram.js`).

## 3. Prérequis côté TikTok (clé API)

Le scraping TikTok passe par l'API tierce
[tiktokapi.store](https://tiktokapi.store) plutôt que par un navigateur (voir
plus haut). Créez un compte sur ce service, récupérez une clé d'API, et
renseignez-la dans `TIKTOK_API_KEY`.

## 4. Installation

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Remplissez le fichier `.env` — voir les commentaires de `.env.example` pour
le détail de chaque variable. Les indispensables pour démarrer :

- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CHANNEL_ID` (section 1)
- `ACCOUNTS` : la liste des comptes à suivre, au format JSON — un objet par
  compte avec un `name` (affiché dans le classement) et un tableau `urls` à
  3 emplacements `[Instagram, TikTok, YouTube]`. Laissez une chaîne vide
  `""` pour une plateforme non suivie sur ce compte (affichée `Ban`).
- `IG_COOKIES_JSON` ou le fichier `src/ig-cookies.json` (section 2)
- `TIKTOK_API_KEY` (section 3)

Le reste (`DISCORD_OWNER_ID`, `CRON_SCHEDULE`, `TIMEZONE`,
`IG_POSTS_LIMIT`, `STUCK_ALERT_MIN_DAYS`, les chemins `*_PATH`) a des
défauts raisonnables et peut être ajusté plus tard.

## 5. Forcer une collecte immédiate

**Sans toucher Discord**, pour tester que le scraping fonctionne :

```bash
npm run scan
```

Scrape tous les comptes de `ACCOUNTS` et affiche le résultat dans le
terminal (`src/scan.js`), sans rien envoyer à Discord.

Pour un test rapide sans les délais anti-détection, utilisez
`FAST_MODE=1 npm run scan`. **À ne jamais utiliser en production.**

**En éditant les vrais messages Discord**, pour rejouer une collecte sans
attendre le prochain cron (utile après un fix, par exemple) :

```bash
npm run run-once
```

Reprend exactement la logique du cron (`scripts/run-once.js`) : édite les
messages `daily`/`allTime` existants comme le ferait la planification
automatique, sans jamais en créer de nouveaux tant que
`last-message.json` pointe vers un message éditable.

## 6. Lancer le bot

```bash
npm start
```

Au démarrage, le bot se connecte à Discord et planifie l'envoi automatique
du résumé dans `DISCORD_CHANNEL_ID` selon `CRON_SCHEDULE`/`TIMEZONE` (log de
confirmation dans la console). Un jitter aléatoire de 0 à 120 min est ajouté
à chaque déclenchement, pour ne pas partir pile à l'heure tous les jours.

Un dashboard web (`web/`, React) démarre aussi en parallèle, indépendamment
de la connexion Discord — voir section 6bis.

## 6bis. Dashboard web

Le bot expose un dashboard web (dossier `web/`, React + Vite), servi par un
serveur Express intégré au même process (`src/server.js`, démarré par
`src/index.js`). Il montre exactement les mêmes chiffres que Discord — gain
24h et cumul all-time (voir `src/dashboardData.js`) — et permet d'ajouter/
modifier/supprimer des comptes suivis sans toucher `ACCOUNTS`/`.env`
(persistés dans `data/accounts.json`, qui prend le relais de `ACCOUNTS`
dès sa création — `ACCOUNTS` ne sert plus que de valeur de départ). Pas de
bouton "Lancer un scan" : la collecte reste pilotée uniquement par le cron
planifié (ou `npm run scan`/`npm run run-once` en CLI).

**Pas d'authentification** — un seul bot, un seul jeu de données : le
dashboard est protégé en amont par le réseau (ex. domaine Railway privé,
ou VPN) plutôt que par un login applicatif. Ne l'exposez pas publiquement
sans mettre un accès devant (reverse proxy avec auth, IP allowlist...).
Version avec comptes utilisateurs/organisations et suivi de clics : voir la
branche `backup/dashboard-rewrite-27-08`, qui nécessite en plus une base
Postgres externe (non utilisée par la version actuelle).

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

**Variable d'env** : `PORT` (optionnel, défaut `3000`).

**Réglages modifiables depuis Paramètres** : publication Discord activée/
désactivée, alertes de scraping, salon et destinataire des MP — persistés
dans `data/settings.json`, effectifs immédiatement (relus à chaque
collecte). Heure de collecte (cron), fuseau horaire et nombre de posts par
plateforme sont aussi éditables mais ne prennent effet qu'au prochain
redémarrage du bot (`cron.schedule()` et `config.postsLimit` sont figés au
démarrage) — indiqué comme tel dans l'UI.

## 7. Alertes et sauvegarde (MP à `DISCORD_OWNER_ID`)

Si `DISCORD_OWNER_ID` est renseigné, l'admin reçoit en MP, après chaque
collecte réussie :

- **⚠️ Échecs de scraping détectés** — le détail des comptes/plateformes en
  échec ce jour-là (message d'erreur inclus), seulement s'il y en a.
- **🔴 Comptes bloqués depuis plusieurs jours** — alerte distincte, qui ne se
  déclenche que si un même compte/plateforme échoue `STUCK_ALERT_MIN_DAYS`
  collectes consécutives (signe d'un vrai problème à corriger — cookie
  expiré, sélecteur cassé — plutôt qu'un raté ponctuel).
- **💾 Sauvegarde des données** — `history.json`, `cumulative-views.json` et
  `last-message.json` en pièces jointes. Le volume d'hébergement n'est pas
  sauvegardé automatiquement par la plateforme (vécu le 09/08/2026 avec la
  perte du cumul all-time suite à un chemin non persistant) ; ce backup
  quotidien donne un filet de secours téléchargeable en cas de volume
  corrompu ou effacé.

## 8. Déploiement en continu (Railway)

Le bot inclut un `Dockerfile` (basé sur l'image officielle Playwright) et
tourne actuellement sur [Railway](https://railway.app), qui le détecte et le
build automatiquement.

1. **New Project → Deploy from GitHub repo**, sélectionnez le repo.
2. **Montez un volume** (ex. sur `/data`) — indispensable pour ne pas perdre
   l'historique, le cumul all-time et le suivi des messages Discord à chaque
   redéploiement.
3. **Variables** : renseignez toutes les variables de la section 4, plus :
   - `IG_COOKIES_JSON` (Railway ne fournit pas de fichier persistant par
     défaut pour `src/ig-cookies.json`)
   - `HISTORY_PATH`, `CUMULATIVE_VIEWS_PATH`, `LAST_MESSAGE_PATH` pointant
     vers le volume monté (ex. `/data/history.json`,
     `/data/cumulative-views.json`, `/data/last-message.json`) — **sans ces
     3 variables, ces fichiers vivent dans le système de fichiers éphémère
     du conteneur et sont perdus à chaque redéploiement**, même si un volume
     est monté par ailleurs.
4. Railway redéploie automatiquement à chaque push sur la branche connectée.

Sur un autre hébergeur (VPS, Render, Raspberry Pi...), tournez plutôt avec
un gestionnaire de process comme `pm2` :

```bash
npm install -g pm2
pm2 start src/index.js --name ig-discord-bot
pm2 save
```

### Limite mémoire

Le scraping bloque volontairement le chargement des images/vidéos/polices
(`src/instagram.js`, fonction `blockHeavyResources`) pour limiter l'usage
mémoire de Chromium — un scan complet peut sinon dépasser la limite RAM
d'un plan d'hébergement modeste et faire crasher le container en plein scan.

## Notes

- `src/embed.js` centralise la construction des messages Discord
  (`build24hEmbed`, `buildAllTimeEmbed`, `buildErrorReportEmbed`,
  `buildStuckAccountsEmbed`).
- Le nombre de posts pris en compte par compte est réglable via
  `IG_POSTS_LIMIT` (2 par défaut). Sur Instagram, les reels **épinglés**
  sont ignorés (ils ne reflètent pas l'activité récente) — détectés via le
  badge `svg[aria-label="Pinned post icon"]` sur chaque vignette. Sur
  TikTok, les vidéos épinglées (`is_top === 1` dans la réponse API) sont
  ignorées de la même façon.
- Utilisez de préférence un compte Instagram dédié au scraping plutôt que
  votre compte personnel, pour limiter les conséquences en cas de
  restriction temporaire par Instagram.
- Les pages publiques d'Instagram/YouTube changent régulièrement de
  structure ; si le scraping d'une plateforme se met à retourner 0 vue
  systématiquement (avec des erreurs en MP), ses sélecteurs sont
  probablement devenus obsolètes et doivent être mis à jour dans
  `src/instagram.js`.
- `scripts/export-tiktok-cookies.js` (et `npm run export-tiktok-cookies`)
  ne sont plus utilisés depuis le passage de TikTok sur l'API
  `tiktokapi.store` (voir section "Comment ça marche") — conservés dans le
  repo mais aucun cookie TikTok n'est lu par `src/instagram.js`.
