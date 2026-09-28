# Audit ViewTracker — Phase 1 (lecture seule)

Date : 2026-09-28. Aucune modification appliquée, aucune requête envoyée aux
réseaux sociaux ni à l'app pendant cet audit (analyse hors ligne des fichiers
du serveur : `history.json`, `cumulative-views.json`, `accounts.json`, et du
code). Deux vérifications ont utilisé les logs Railway existants et la base
de l'app en lecture seule.

## A. Inventaire

- **Planificateur** : `node-cron`, expression `CRON_SCHEDULE` (`30 22 * * *`
  par défaut), dans `src/index.js:203-215`. Un décalage aléatoire de 0 à
  120 min est appliqué après le déclenchement (`src/index.js:198-201`),
  avant d'appeler `scrapeAndBroadcast`.
- **Collecteurs** : Instagram et YouTube sont scrapés via Playwright dans
  `src/instagram.js` (fonction unique `buildViewsSummary`, branches par
  plateforme lignes ~330-500) ; TikTok via `yt-dlp` dans `src/tiktok.js`
  (`fetchTikTokPosts`).
- **Stockage** : `src/history.js` (`history.json`, un snapshot par collecte),
  `src/cumulativeViews.js` (`cumulative-views.json`, cumul all-time),
  `src/accountsStore.js` (`accounts.json`, comptes suivis). Les clics sont
  dans une base SQLite séparée (`src/clicksStore.js`), hors du périmètre de
  cet audit.
- **Envoi** : `src/supabaseViews.js` (`pushViewsToSupabase`), déclenché après
  chaque collecte, au démarrage, et manuellement. Comptes synchronisés depuis
  l'app via `src/accountsSync.js` (`syncAccountsFromApp`, lit
  `GET /api/public/clipper-accounts` avec ETag).
- **`account_name`** : `accountsStore.js` champ `name`, égal au pseudo
  ViewTracker du compte suivi ; côté app, rattaché au clipper par
  `discord_name` (correspondance insensible à la casse, logique côté app).
- **Limite « 2 dernières publications »** : `IG_POSTS_LIMIT` (variable
  d'environnement Railway, valeur actuelle **2**), lue dans
  `src/config.js:42` (`postsLimit: Number(process.env.IG_POSTS_LIMIT) || 5`
  — le défaut code est 5, mais la production est réglée à 2). Elle est
  transmise à `buildViewsSummary(accounts, postsLimit)` puis à chaque
  extracteur : `extractInstagramViews` (`src/parseViews.js:79`),
  `fetchTikTokPosts(url, postsLimit)` (`src/tiktok.js`),
  `extractYouTubeViews` (`src/parseViews.js:114`).

## B. Panne du 03/09 au 22/09 et jours isolés manquants (14/08, 20/08, 26/08, 01/09)

**Cause de la panne du 03/09 au 22/09 : le service n'existait pas.**
Confiance : **haute**.

Preuve directe : `railway deployment list` ne montre **aucun déploiement**
avant le 2026-09-24 16:19 sur le projet/service actuels — le tout premier
déploiement visible date de cette heure-là. `history.json` confirme
l'absence de toute collecte entre le 2026-09-02 et le 2026-09-23 (liste des
dates : `08-08 … 08-31, 09-02, 09-23, 09-24 …`, aucune date entre les deux).
Ceci correspond à la migration du bot vers ce projet Railway (l'ancien
service a été arrêté avant que le nouveau ne soit opérationnel). Aucune
erreur applicative n'est en cause : le processus ne tournait tout simplement
pas, donc aucun log, aucune tentative d'envoi, aucune ligne `post_views` sur
cette période — cohérent avec l'observation de l'app.

Les logs Railway eux-mêmes ne remontent pas jusqu'à début septembre (rétention
limitée) ; la preuve retenue est l'absence de déploiement plus ancien, pas un
log d'erreur.

**Reprise en escalier (Instagram vers le 19/09, TikTok/YouTube vers le
22-23/09)** : cohérent avec le mécanisme de référence par plateforme de
`computeGrowth24h` (`src/history.js`, fonction `findBaseline`) — chaque
plateforme cherche indépendamment sa dernière collecte réussie comme
référence, donc IG a pu reprendre un calcul de gain correct dès sa première
collecte post-migration réussie, indépendamment de TT/YT.

**Jours isolés manquants (14/08, 20/08, 26/08, 01/09) : cause différente,
déjà identifiée et corrigée dans une session précédente.** Confiance :
**haute**.

Avant le 2026-09-27, la date d'une collecte était fixée à la fin du scraping
(`todayKey()` appelé après le décalage aléatoire). Une collecte démarrée à
22h30 le jour D mais terminée après minuit était donc enregistrée à la date
D+1, et `appendToday` *remplace* l'entrée existante du même jour
(`history.js`, filtre `h.date !== date`). Si la collecte du soir D+1
terminait elle aussi le même jour calendaire D+1, elle écrasait l'entrée
issue de la collecte de D — un jour entier de gain disparaissait de
l'historique brut. Corrigé le 2026-09-27 (commit
« Collectes datées au jour du cron... ») : la date est désormais figée à
l'heure de déclenchement du cron (`src/index.js:197`,
`collectionDate = todayKey()` avant le `setTimeout` du décalage), passée
explicitement à `computeGrowth24h`, `updateCumulativeViews` et `appendToday`.

**Conséquence sur `post_views` vs `daily_views`** : `post_views` est
construit directement depuis `history.json` (`buildPostViewsRows`,
`src/supabaseViews.js`) — un jour absent de l'historique brut n'y a donc
aucune ligne, pour ces 4 dates comme pour toute la période de panne.
`daily_views`, en revanche, est reconstruit avec une répartition sur les
jours d'un « trou » de collecte (`buildDailyViewsRows`, même fichier,
`GAP_DAYS = 2`) : quand deux collectes sont espacées de plus d'un jour, le
gain est réparti sur les jours intermédiaires et ces lignes portent
`estimated: true`. C'est pourquoi l'app a des lignes `daily_views` pour ces
4 dates (et pour toute la période de panne) sans ligne `post_views`
correspondante — comportement voulu, pas une incohérence.

## C. Sémantique des données

- **`views` / `views_ig` / `views_tt` / `views_yt`** (`daily_views`) : pour
  chaque collecte, `computeGrowth24h` (`src/history.js`) calcule le gain par
  vidéo suivie (diff avec la même vidéo à la collecte de référence, ou vues
  totales si la vidéo est nouvelle) et somme par plateforme. Quand l'écart
  entre deux collectes dépasse 1 jour, `buildDailyViewsRows` répartit ce
  total sur les jours du trou (pondéré par date de publication connue pour
  IG/TT, sinon par le rythme des vidéos datées du même compte) au lieu de le
  poser en entier sur le jour de la collecte.
- **`account_views` (total, ig, tt, yt)** : `total` = cumul all-time réel,
  mis à jour à chaque collecte par `updateCumulativeViews`
  (`src/cumulativeViews.js`), jamais recalculé depuis zéro. **`ig`/`tt`/`yt`
  envoyés à l'app sont mis à 0 si la plateforme n'a plus d'URL configurée**
  pour ce compte (`buildAccountViewsRows`, `src/supabaseViews.js` — masquage
  volontaire d'un compte banni/retiré), alors que `total` garde son
  historique réel. **C'est l'origine exacte de l'écart signalé au point 5** :
  fonctionnalité intentionnelle (ajoutée le 2026-09-27 à la demande de
  l'utilisateur : « masquer les vues » d'un réseau qui n'est plus suivi),
  pas un bug.
- **Échec de scrape vs plateforme non suivie** : deux cas distincts dans
  `src/instagram.js`.
  - URL vide pour cette plateforme → la variable reste `null` (init ligne
    232-234) → le compte est marqué « Ban »/non suivi, aucune tentative de
    scrape.
  - URL présente mais scrape en échec → `scrapeWithRetry` (2 tentatives avec
    backoff) renvoie `{ total: 0, posts: [], error: message }`
    (`src/instagram.js:169-192`) → la valeur envoyée est **0**, avec une
    entrée dans `errors[]` portant le message. Ce n'est ni une répétition de
    la dernière valeur, ni une absence de ligne : c'est un 0 explicite,
    accompagné d'une preuve d'échec.

## D. Couverture

**Confiance moyenne** : évaluation faite lors d'une session précédente
(2026-09-27), non re-vérifiée par une requête live dans cet audit (règle en
place : ne jamais interroger IG/TT/YT ad hoc, voir mémoire projet).

- Instagram : le premier écran de l'onglet Reels affiche environ 12 reels
  sans défilement.
- YouTube : la grille des Shorts en affiche plusieurs dizaines sur une seule
  page.
- TikTok : `yt-dlp --flat-playlist --playlist-end N` fait un seul appel ;
  TikTok répond avec plusieurs dizaines d'entrées par appel.

Conclusion (reprise de l'analyse du 27/09) : passer de 2 à 6 vidéos ne
change ni le nombre de requêtes ni le comportement (toujours une seule page
chargée par compte/plateforme), donc pas de risque supplémentaire de
blocage. **10 à 12 est plus risqué côté Instagram** spécifiquement : au-delà
d'environ 12, il faudrait faire défiler la grille pour en charger davantage,
ce qui ajouterait des interactions et un pattern plus repérable. 6 restait
la recommandation, jamais appliquée (le paramètre `IG_POSTS_LIMIT` est resté
à 2 en production).

**Durée de la collecte vs fenêtre 22h30-00h30** : non mesurée précisément
dans cet audit (pas de log de durée totale conservé). Avec délais aléatoires
entre comptes (`randomDelay`), 20 comptes × 3 plateformes, la collecte
observée dans les logs récents se termine généralement dans l'heure suivant
son démarrage (ex. 23h03 → 23h16 le 27/09). Passer de 2 à 6 vidéos par
plateforme n'allonge pas le nombre de pages chargées, donc l'impact sur la
durée totale serait marginal (traitement DOM légèrement plus long par page).

## E. Fiabilité

- **Gestion des erreurs / retry** : `scrapeWithRetry` fait 2 tentatives par
  plateforme et par compte avec backoff exponentiel
  (`src/instagram.js:169-192`). Côté envoi vers l'app,
  **aucun retry automatique dans l'appel courant** : `send()`
  (`src/supabaseViews.js`) lève une exception au premier échec HTTP, sans
  nouvelle tentative ni file d'attente locale.
- **Idempotence** : oui. Chaque envoi renvoie **tout l'historique**
  (`buildDailyViewsRows`/`buildPostViewsRows` reconstruisent depuis
  `history.json` complet), avec upsert sur des clés naturelles côté app
  (`account_name+day`, `platform+post_id+day`). Un envoi raté est donc
  automatiquement rattrapé au prochain passage réussi (après la collecte
  suivante, au redémarrage, ou lors d'un appel manuel), sans duplication.
- **Alerte en cas d'échec d'envoi** : **absente**. `pushViewsToSupabase`
  logue l'erreur en console (`console.error`,
  `src/supabaseViews.js:296,304`) mais ne déclenche aucune notification
  Discord — contrairement aux échecs de scrape, qui sont envoyés en MP au
  propriétaire (`sendErrorReportToOwner`, `src/index.js`). Un échec d'envoi
  silencieux et prolongé (ex. clé invalidée côté app) ne serait visible que
  via les logs Railway.
- **Contrôle de santé** : `scan-status.json` (`lastScanAt`, `lastScanError`)
  suit la collecte, pas l'envoi vers l'app. Aucun `sync-status` équivalent
  pour `pushViewsToSupabase`/`syncAccountsFromApp` (contrairement à
  l'ancienne synchro Supabase directe qui, elle, écrivait un statut).
- **Convention de `day` autour de minuit** : corrigée le 2026-09-27 (voir
  point B) — `day` = date du déclenchement du cron, en heure de Paris, fixée
  avant le délai aléatoire. Le risque de collision inter-jours qui causait
  les 4 dates manquantes est éliminé pour les collectes futures.

## F. Envoi

- **Découpage** : par lots de **500** lignes (`BATCH_SIZE = 500`,
  `src/supabaseViews.js:21`), sous la limite de 1000 annoncée par l'app.
- **Lecture de la réponse** : `send()` ne lit le corps de la réponse **que
  sur échec** (`res.text()` pour le message d'erreur). **Le corps de succès
  `{ ok, count, skipped }` n'est jamais lu** — si l'app ignore silencieusement
  des lignes invalides (`skipped > 0`), le bot ne le détecte pas et l'affiche
  comme un envoi pleinement réussi. Point faible identifié, aucun impact
  connu à ce jour (les lignes envoyées sont validées côté bot avant envoi).
- **`clipper-accounts` (ETag)** : utilisé. `src/accountsSync.js` mémorise
  `lastEtag` et envoie `If-None-Match`, traite le `304` comme « comptes
  inchangés » sans réécrire les fichiers locaux.
- **Route `/notify`** : **non implémentée côté bot** (choix assumé lors de
  la mise en place : le bot interroge lui-même `clipper-accounts` avant
  chaque collecte et toutes les 30 min, plutôt que d'exposer une route
  publique supplémentaire). Confirmé par grep : aucune référence à `notify`
  dans `src/` ni `scripts/`.

## G. Sécurité

Aucun secret trouvé dans les logs générés par le code : les lignes
`console.log`/`console.error` de `supabaseViews.js` et `accountsSync.js`
n'impriment que des messages et des compteurs, jamais `VIEWS_INGEST_SECRET`
ni les en-têtes de requête. Les cookies de session Instagram sont chargés
depuis un fichier (`IG_COOKIES_PATH`) ou une variable d'environnement, jamais
loggés dans le code parcouru pour cet audit.

## Questions ouvertes

1. Durée exacte de la collecte complète (20 comptes × 3 plateformes) n'est
   pas mesurée/loguée en tant que telle aujourd'hui — à instrumenter si on
   veut chiffrer précisément la marge avant de relever `IG_POSTS_LIMIT`.
2. Pas de log conservé antérieur au 2026-09-24 : impossible de confirmer par
   un log direct que le service était bien arrêté (plutôt qu'en échec muet)
   entre le 03/09 et le 22/09 — la preuve retenue est indirecte (absence de
   déploiement Railway).

## Plan de correction proposé (non appliqué — phase 2 après validation)

Par priorité :

1. **Alerte Discord sur échec d'envoi persistant** — dans `pushViewsToSupabase`,
   après un échec, envoyer un MP au propriétaire si le dernier envoi réussi
   date de plus de 24h (nouveau fichier de statut, sur le même modèle que
   `scanStatus.js`).
2. **Lire et loguer `skipped`** dans `send()` sur les réponses `ok`, pour
   détecter un désaccord silencieux avec l'app sur le format des lignes.
3. **Relever `IG_POSTS_LIMIT` de 2 à 6** sur Railway — aucun changement de
   code requis, juste la variable d'environnement. Effet : réduit le nombre
   de vidéos jamais suivies plus d'un jour (65 % aujourd'hui), améliore la
   détection de wins et la précision du cumul. Risque anti-bot jugé
   négligeable (voir point D).
4. **Réessai avec backoff dans `send()`** (2-3 tentatives) avant de
   considérer l'envoi en échec, pour absorber les pannes réseau/5xx courtes
   sans attendre le prochain passage.

Aucun de ces points ne modifie le format des données déjà envoyées
(`daily_views`, `account_views`, `post_views` restent inchangés).
