import { useMemo, useState } from 'react';

// Filtrage/tri partagé entre DashboardView et AccountsView — appliqué
// côté client sur le payload complet renvoyé par GET /api/accounts (ou
// /api/dashboard), comme dans la maquette d'origine (renderVals()).
export function useAccountFilters(accounts) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [sort, setSort] = useState('total');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = accounts
      .filter((a) => (status === 'all' ? true : status === 'active' ? a.total > 0 : a.total === 0))
      .filter((a) => (platform === 'all' ? true : a[platform] > 0))
      .filter((a) => a.name.toLowerCase().includes(q));

    // Le filtre "Plateforme" sert aussi de classement : une fois une
    // plateforme précise sélectionnée, le tri "total" classe par les vues
    // de cette plateforme plutôt que par le total toutes plateformes
    // confondues (pas de contrôle de tri séparé à ajouter, voir
    // DashboardView.jsx pour le sous-titre qui reflète ce choix).
    list = [...list].sort((x, y) => {
      if (sort === 'nom') return x.name.localeCompare(y.name);
      if (sort === 'croissance') return y.growth24h - x.growth24h;
      if (platform !== 'all') return (y[platform] || 0) - (x[platform] || 0);
      return y.total - x.total;
    });
    return list;
  }, [accounts, search, status, platform, sort]);

  const active = status !== 'all' || platform !== 'all' || search.length > 0;
  const reset = () => { setSearch(''); setStatus('all'); setPlatform('all'); };

  return { search, setSearch, status, setStatus, platform, setPlatform, sort, setSort, filtered, active, reset };
}
