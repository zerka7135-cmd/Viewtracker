import { loadAccounts } from './accountsStore.js';
import { loadHistory, computeGrowth24h } from './history.js';
import { getPeriodTotals } from './clicksStore.js';
import { loadSettings } from './settingsStore.js';

// Données de la page Clippers du dashboard : par compte et pour une période,
// les vues gagnées (scraping, voir history.js), les clics, formulaires
// remplis et cash collecté (envoyés par une source externe, voir
// clicksStore.js), puis les chiffres qui en découlent.
//
//   commission    = clics × commissionPerClick (réglage, 0,18 € par défaut)
//   opt-in        = formulaires remplis ÷ clics
//   € / trafic    = cash collecté ÷ clics
//   bénéfice      = cash collecté − commission
//   ROAS          = cash collecté ÷ commission
//
// Les montants sont calculés en centimes entiers puis convertis en euros :
// la somme des lignes retombe exactement sur le total affiché.

/**
 * Vues gagnées par compte sur la période : somme des gains de chaque
 * collecte comprise entre `from` et `to` (bornes incluses, `null` = sans
 * borne), calculés comme le gain « 24h » de Discord (voir
 * history.js#computeGrowth24h) collecte par collecte.
 * @returns {Map<string, number>|null} null si aucune collecte dans la période
 */
export function viewsGainedByAccount(from, to) {
  const history = loadHistory();
  const views = new Map();
  let entriesInPeriod = 0;

  history.forEach((entry, index) => {
    if ((from && entry.date < from) || (to && entry.date > to)) return;
    // La toute première collecte n'a pas de référence : rien à comparer.
    if (index === 0) return;
    entriesInPeriod++;

    const growth = computeGrowth24h(history.slice(0, index), entry.accounts);
    for (const [account, g] of growth) {
      views.set(account, (views.get(account) || 0) + g.total);
    }
  });

  return entriesInPeriod > 0 ? views : null;
}

const toEuros = (cents) => cents / 100;

/**
 * @param {{from?: string|null, to?: string|null}} period YYYY-MM-DD, bornes incluses
 */
export function getClippersReport({ from = null, to = null } = {}) {
  const rate = loadSettings().commissionPerClick;
  const totals = getPeriodTotals(from, to);
  const views = viewsGainedByAccount(from, to);

  const rows = loadAccounts().map((account) => {
    const t = totals.get(account.name) || { clicks: 0, forms: 0, cashCents: 0 };
    const commissionCents = Math.round(t.clicks * rate * 100);
    return {
      name: account.name,
      views: views ? (views.get(account.name) || 0) : null,
      clicks: t.clicks,
      forms: t.forms,
      optIn: t.clicks > 0 ? (t.forms / t.clicks) * 100 : null,
      eurPerTraffic: t.clicks > 0 ? toEuros(t.cashCents) / t.clicks : 0,
      commission: toEuros(commissionCents),
      cash: toEuros(t.cashCents),
      profit: toEuros(t.cashCents - commissionCents),
      _commissionCents: commissionCents,
      _cashCents: t.cashCents
    };
  });

  const sum = (key) => rows.reduce((total, r) => total + r[key], 0);
  const clicks = sum('clicks');
  const forms = sum('forms');
  const commissionCents = sum('_commissionCents');
  const cashCents = sum('_cashCents');

  rows.forEach((r) => { delete r._commissionCents; delete r._cashCents; });
  rows.sort((a, b) => b.clicks - a.clicks || a.name.localeCompare(b.name));

  return {
    period: { from, to },
    commissionPerClick: rate,
    kpis: {
      clicks,
      optInRate: clicks > 0 ? (forms / clicks) * 100 : null,
      eurPerTraffic: clicks > 0 ? toEuros(cashCents) / clicks : 0,
      toPay: toEuros(commissionCents),
      cash: toEuros(cashCents),
      profit: toEuros(cashCents - commissionCents),
      roas: commissionCents > 0 ? cashCents / commissionCents : null
    },
    rows
  };
}
