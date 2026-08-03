# Bot Discord — Résumé des vues (Instagram / TikTok / YouTube)

Bot Discord qui scrape les dernières publications (Reels/vidéos) d'une liste
de comptes sur Instagram, TikTok et YouTube, additionne leurs vues, et
affiche un classement — automatiquement chaque jour dans un salon Discord,
et à la demande via la commande `/views`.

⚠️ **Comment ça marche** : le bot ne passe par aucune API officielle. Il pilote
un navigateur headless (Playwright, avec plugin stealth) qui charge directement
les pages publiques des comptes et lit les compteurs de vues affichés à
l'écran. C'est plus simple à mettre en place qu'une intégration API, mais
c'est aussi plus fragile : si Instagram/TikTok/YouTube changent la structure
de leurs pages, le scraping peut casser sans prévenir. Un usage intensif
présente aussi un risque de blocage/rate-limit du compte utilisé pour la
session Instagram.

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

## 4. Commande à la demande `/views`

`/views` **n'effectue pas de scraping en direct**. Elle affiche instantanément
le dernier résultat sauvegardé lors de la collecte automatique quotidienne
(dans `data/last-summary.json`), avec un footer indiquant l'heure de cette
collecte.

Ce choix est volontaire : avec beaucoup de comptes suivis, un scraping complet
peut prendre plusieurs minutes, et **le jeton d'interaction Discord expire au
bout de 15 minutes** — au-delà d'une certaine taille de liste, relancer un
scraping à chaque appel de `/views` finirait par échouer silencieusement.

Enregistrez la commande auprès de Discord (à faire une seule fois, ou à
chaque modification de `src/commands.js`) :

```bash
npm run deploy-commands
```

- Si `DISCORD_GUILD_ID` est renseigné, la commande apparaît **instantanément**
  sur ce serveur.
- Sinon, elle est déployée **globalement** et peut mettre jusqu'à 1h à
  apparaître.

### Forcer une collecte immédiate

Avant la première exécution du cron, ou pour tester sans attendre l'heure
planifiée, vous pouvez lancer une collecte manuelle indépendamment de
Discord :

```bash
npm run scan
```

Ça scrape tous les comptes de `ACCOUNTS`, affiche le résultat dans le
terminal, et le sauvegarde — `/views` reflétera alors immédiatement ce
résultat.

Pour un test rapide sans attendre les délais volontaires anti-détection
(3-8 secondes entre chaque requête), utilisez `FAST_MODE=1 npm run scan`.
**À ne jamais utiliser en production** : le rythme de requêtes redevient
alors facilement détectable comme automatisé.

## 5. Lancer le bot

```bash
npm start
```

Au démarrage, le bot :
- écoute la commande `/views` ;
- planifie l'envoi automatique du résumé dans `DISCORD_CHANNEL_ID` selon
  `CRON_SCHEDULE`/`TIMEZONE` (log de confirmation dans la console).

## 6. Déploiement en continu (Railway)

Le bot inclut un `Dockerfile` (basé sur l'image officielle Playwright) et
tourne actuellement sur [Railway](https://railway.app), qui le détecte et le
build automatiquement.

1. **New Project → Deploy from GitHub repo**, sélectionnez le repo.
2. **Variables** : renseignez toutes les variables de la section 3
   (`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`,
   `DISCORD_CHANNEL_ID`, `ACCOUNTS`, `CRON_SCHEDULE`, `TIMEZONE`), plus
   `IG_COOKIES_JSON` (voir section 2) puisque Railway ne fournit pas de
   volume par défaut pour `src/ig-cookies.json`.
3. **Volume** : montez un volume sur `/app/data` (Settings → Volumes) pour
   que le cache `data/last-summary.json` (lu par `/views`) survive aux
   redéploiements. Sans ça, il repart à zéro à chaque déploiement, jusqu'à
   la prochaine collecte automatique.
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

Le scraping bloque volontairement le chargement des images/vidéos/polices
(`src/instagram.js`, fonction `blockHeavyResources`) pour limiter l'usage
mémoire de Chromium — un scan complet peut sinon dépasser la limite RAM
d'un plan d'hébergement modeste (ex. 1 Go sur le plan gratuit Railway) et
faire crasher le container en plein scan.

## Notes

- `src/embed.js` centralise la construction du message (`buildLeaderboardEmbed`),
  utilisée à la fois par `/views` et par l'envoi automatique : toute
  évolution du format s'applique aux deux.
- `data/last-summary.json` contient le dernier résultat de scraping (généré
  par le cron ou `npm run scan`) — c'est ce fichier que `/views` lit. Il est
  exclu du dépôt git (`.gitignore`) : pas besoin de le committer, il se
  régénère à chaque collecte.
- Le nombre de posts pris en compte par compte est actuellement fixé à 5
  dans `src/instagram.js` (les 5 derniers Reels/vidéos par plateforme). Sur
  Instagram, les reels **épinglés** sont ignorés dans ce calcul (ils ne
  reflètent pas l'activité récente) — détectés via le badge
  `svg[aria-label="Pinned post icon"]` sur chaque vignette.
- Utilisez de préférence un compte Instagram dédié au scraping plutôt que
  votre compte personnel, pour limiter les conséquences en cas de
  restriction temporaire par Instagram.
- Les pages publiques d'Instagram/TikTok/YouTube changent régulièrement de
  structure ; si le scraping d'une plateforme se met à retourner 0 vue
  systématiquement, ses sélecteurs sont probablement devenus obsolètes et
  doivent être mis à jour dans `src/instagram.js`.
