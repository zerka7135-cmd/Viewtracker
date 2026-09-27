Dans src/components/ViewsDashboard.tsx (écran Vues), le jour en cours n'a pas encore de données : les vues d'un jour n'arrivent qu'après la collecte du soir (vers 22h30-00h30). Aujourd'hui est donc affiché à 0, ce qui fausse trois choses. Corrige-les sans rien changer d'autre (ni style, ni données, ni autres écrans) :

1. Graphique « Vues totales sur les N derniers jours » : la série doit s'arrêter au dernier jour collecté (le max de daily_views.day), pas à aujourd'hui. Si la période demandée se termine après ce jour, ne pas afficher les jours suivants (pas de point à 0 en fin de courbe).

2. Évolution « ▲/▼ x % sur N jours » : la calculer sur cette même série arrêtée au dernier jour collecté.

3. Mini-courbe « 7 jours » du classement des comptes (et sa tendance en hausse / en baisse / stable) : prendre les 7 jours se terminant au dernier jour collecté (m.lastDay), pas les 7 jours se terminant aujourd'hui (last7 = daysAgo(6 - i)).

Applique la même règle à la courbe des vues dans ClipperDetailPanel si elle trace aussi le jour en cours à 0.
