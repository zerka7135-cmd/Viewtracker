Ajoute un écran « Vues » au Dashboard, avec un toggle switch Vues / Clics. Ne modifie pas l'écran des clics existant ni la base de données : les vues sont déjà dans les tables `daily_views` et `account_views`, en lecture seule.

## Données

- `daily_views` : account_name, day (date), clipper_id, views, views_ig, views_tt, views_yt : vues gagnées ce jour-là par compte.
- `account_views` : account_name, clipper_id, total, ig, tt, yt, updated_at : cumul all-time par compte.
- Un compte = un clipper (relié par clipper_id, sinon afficher account_name).
- Une plateforme dont le cumul all-time vaut 0 est considérée comme non suivie : afficher « — ».

## Toggle Vues / Clics

- En haut à droite du Dashboard : un toggle switch en pilule, deux options « Vues » et « Clics ». L'option active a un fond bleu plein et un texte blanc.
- « Clics » affiche le Dashboard actuel, sans aucun changement. « Vues » affiche le nouvel écran ci-dessous.
- Le choix est mémorisé (localStorage) et « Vues » est l'option par défaut.
- Visible pour les admins et les managers. Le dashboard des clippers ne change pas.
- En mode Vues, à gauche du toggle : un point vert + « Dernière collecte il y a Xh (HH:MM) », calculé depuis le max de account_views.updated_at.
- Titre en mode Vues : « Dashboard », sous-titre « Classement, tendance et répartition des vues — Instagram, TikTok, YouTube ».

## Écran Vues

### 1. Quatre cartes KPI (une ligne, empilées sur mobile)
- **Vues totales (cumul)** : somme de account_views.total, sous-texte « sur N comptes suivis ».
- **Vues gagnées (24h)** : somme de daily_views.views du jour le plus récent, sous-texte vert « depuis la dernière collecte ».
- **Comptes suivis** : nombre de lignes de account_views, sous-texte « tous configurés ».
- **Répartition par plateforme** : la plateforme majoritaire (sommes ig / tt / yt de account_views) en grand, dans sa couleur, avec son pourcentage. En dessous, les deux autres avec une pastille de couleur et leur %.

Chiffres en police mono, séparateur de milliers avec espace (4 622 843).

### 2. Graphique « Vues totales — N derniers jours »
- Courbes, une par plateforme sur la même échelle : Instagram (rose #e1306c), TikTok (bleu #3b9ede), YouTube (rouge #ff4d3d). Valeur par jour = somme de daily_views.views_ig / views_tt / views_yt, tous comptes confondus.
- Sous-titre « Une ligne par plateforme, même échelle », légende avec pastilles en bas.
- En haut à droite : sélecteur de période en pilules 24h / 7j / 14j / 30j (14j par défaut, pilule active en bleu plein). Juste à gauche : l'évolution en vert avec ▲, ou en rouge avec ▼, entre la première et la seconde moitié de la période (« ▲ 76.6% sur 14 jours »).
- Tooltip au survol : date + valeur de chaque plateforme.

### 3. Tableau « Classement des comptes »
- Sous-titre « Classement cumulé — trié par total de vues ». À droite, « N compte(s) ».
- Filtres sur une ligne : recherche par nom, « Plateforme : toutes / Instagram / TikTok / YouTube » (garde les comptes qui ont cette plateforme), « Trier : total / 24h / IG / TT / YT ».
- Colonnes : # (le n°1 en orange), COMPTE, IG, TT, YT (cumuls all-time, format compact 287.4K, « — » si non suivie), TOTAL (en gras), 24H (vues gagnées le dernier jour, en vert avec « + »), et une mini-courbe (sparkline) verte des vues gagnées sur les 7 derniers jours.
- Clic sur une ligne : ouvre la page existante du clipper correspondant (si clipper_id est renseigné).
- Pas de boutons Ajouter, Modifier ou Supprimer : les comptes sont gérés par le bot.
- Sur mobile : chaque ligne devient une carte (nom + total en haut, IG / TT / YT / 24H en dessous).

## Style
Garde le thème sombre, les couleurs, les polices et les composants actuels de l'app. Cartes arrondies avec une bordure fine, cohérentes avec le Dashboard Clics. États de chargement en squelette gris, état vide « Aucune vue pour l'instant ».
