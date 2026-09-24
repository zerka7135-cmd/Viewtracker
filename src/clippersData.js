import { loadAccounts } from './accountsStore.js';
import { loadHistory, computeGrowth24h, todayKey } from './history.js';
import { getPeriodTotals, getDailyRows, getLinkTotals } from './clicksStore.js';
import { loadSettings } from './settingsStore.js';

// Données des pages « clippers » du dashboard : par compte suivi et pour une
// période, les vues gagnées (scraping, voir history.js), les clics,
// formulaires remplis et cash collecté (synchronisés depuis Supabase ou
// envoyés à l'API, voir clicksStore.js), et ce qui en découle. Les formules
// sont celles de l'app de référence (Clipper HQ) :
//
//   commission = clics × tarif par clic du clipper (le sien, sinon le tarif par défaut)
//   cash (€)   = cash brut de la source × coefficient de conversion (0,8732)
//   opt-in     = formulaires remplis ÷ clics
//   € / trafic = cash (€) ÷ clics
//   bénéfice   = cash (€) − commission
//   ROAS       = cash (€) ÷ commission
//
// Les montants sont calculés en centimes entiers puis convertis en euros :
// la somme des lignes retombe exactement sur le total affiché.
//
// Qui a le droit de voir quoi est décidé ICI, côté serveur (voir
// restrictReport) : l'interface ne fait que mettre en forme ce qu'elle reçoit.

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
const pick = (object, keys) => Object.fromEntries(keys.map((k) => [k, object[k]]));

/** Tarif par clic (€) d'un compte : le sien, sinon le tarif par défaut des réglages. */
function rateFor(account, settings) {
  return Number.isFinite(account.rateClick) ? account.rateClick : settings.commissionPerClick;
}

/** Cash brut (centimes de la devise source) -> centimes d'euro. */
const convertCash = (rawCents, settings) => Math.round(rawCents * settings.cashConversionRate);

// ---------------------------------------------------------------------------
// Tableau « Tous les clippers » (dashboards admin et manager)
// ---------------------------------------------------------------------------

/**
 * @param {{from?: string|null, to?: string|null}} period YYYY-MM-DD, bornes incluses
 * @param {{role?: 'admin'|'manager'}} [viewer]
 */
export function getClippersReport({ from = null, to = null } = {}, { role = 'admin' } = {}) {
  const settings = loadSettings();
  const totals = getPeriodTotals(from, to);
  const views = viewsGainedByAccount(from, to);

  const rows = loadAccounts().map((account) => {
    const t = totals.get(account.name) || { clicks: 0, forms: 0, cashCents: 0 };
    const commissionCents = Math.round(t.clicks * rateFor(account, settings) * 100);
    const cashCents = convertCash(t.cashCents, settings);
    return {
      name: account.name,
      views: views ? (views.get(account.name) || 0) : null,
      clicks: t.clicks,
      forms: t.forms,
      optIn: t.clicks > 0 ? (t.forms / t.clicks) * 100 : null,
      eurPerTraffic: t.clicks > 0 ? toEuros(cashCents) / t.clicks : 0,
      commission: toEuros(commissionCents),
      cash: toEuros(cashCents),
      profit: toEuros(cashCents - commissionCents),
      _commissionCents: commissionCents,
      _cashCents: cashCents
    };
  });

  const sum = (list, key) => list.reduce((total, r) => total + r[key], 0);
  const sortRows = (list) => list.sort((a, b) => b.clicks - a.clicks || a.name.localeCompare(b.name));

  // Le manager voit tous les clippers, l'admin seulement ceux qui ont des clics
  // sur la période (comme l'app de référence).
  const visible = role === 'admin' ? rows.filter((r) => r.clicks > 0) : rows;
  const clicks = sum(visible, 'clicks');
  const forms = sum(visible, 'forms');
  const commissionCents = sum(visible, '_commissionCents');
  const cashCents = sum(visible, '_cashCents');
  const clean = (r) => { const { _commissionCents, _cashCents, ...rest } = r; return rest; };

  const base = {
    period: { from, to },
    commissionPerClick: settings.commissionPerClick,
    cashConversionRate: settings.cashConversionRate
  };
  const optInRate = clicks > 0 ? (forms / clicks) * 100 : null;
  const eurPerTraffic = clicks > 0 ? toEuros(cashCents) / clicks : 0;

  if (role === 'manager') {
    // Pas de cash collecté, bénéfice ni ROAS : finances de l'entreprise.
    const rowKeys = ['name', 'views', 'clicks', 'forms', 'optIn', 'eurPerTraffic', 'commission'];
    return {
      ...base,
      kpis: { clippers: rows.length, clicks, optInRate, eurPerTraffic, commissions: toEuros(commissionCents) },
      rows: sortRows(visible.map((r) => pick(clean(r), rowKeys)))
    };
  }

  return {
    ...base,
    kpis: {
      clicks,
      optInRate,
      eurPerTraffic,
      toPay: toEuros(commissionCents),
      cash: toEuros(cashCents),
      profit: toEuros(cashCents - commissionCents),
      roas: commissionCents > 0 ? cashCents / commissionCents : null
    },
    rows: sortRows(visible.map(clean))
  };
}

// ---------------------------------------------------------------------------
// Page d'un clipper (dashboard clipper, et détail depuis admin/manager)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function eachDay(from, to) {
  const days = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Stats d'un seul compte : chiffres clés, courbe « clics par jour » (avec les
 * gains du jour) et détail par lien.
 * @returns {object|null} null si le compte n'existe pas
 */
export function getClipperDetail({ from = null, to = null } = {}, accountName) {
  const settings = loadSettings();
  const account = loadAccounts().find((a) => a.name === accountName);
  if (!account) return null;

  const rate = rateFor(account, settings);
  const daily = getDailyRows(from, to, account.name);
  const byDate = new Map(daily.map((r) => [r.date, r]));

  // « Tout » n'a pas de borne : la courbe part du premier jour avec des données.
  const end = to || todayKey();
  const start = from || daily[0]?.date || end;
  const series = eachDay(start, end).map((date) => {
    const clicks = byDate.get(date)?.clicks ?? 0;
    return { date, clicks, gains: Math.round(clicks * rate * 100) / 100 };
  });

  const clicks = daily.reduce((s, r) => s + r.clicks, 0);
  const forms = daily.reduce((s, r) => s + r.forms, 0);
  const cashCents = convertCash(daily.reduce((s, r) => s + r.cashCents, 0), settings);
  const views = viewsGainedByAccount(from, to);

  return {
    name: account.name,
    period: { from, to },
    ratePerClick: rate,
    kpis: {
      views: views ? (views.get(account.name) || 0) : null,
      clicks,
      forms,
      optInRate: clicks > 0 ? (forms / clicks) * 100 : null,
      eurPerTraffic: clicks > 0 ? toEuros(cashCents) / clicks : 0,
      gains: toEuros(Math.round(clicks * rate * 100))
    },
    series,
    links: getLinkTotals(account.name, from, to).map((l) => ({
      name: l.link,
      clicks: l.clicks,
      gains: Math.round(l.clicks * rate * 100) / 100
    }))
  };
}

// ---------------------------------------------------------------------------
// Leaderboard et « jour par jour »
// ---------------------------------------------------------------------------

/**
 * Classement aux clics sur la période. Les gains de chaque clipper ne sont
 * renvoyés qu'à l'admin.
 */
export function getLeaderboard({ from = null, to = null } = {}, { role = 'clipper' } = {}) {
  const settings = loadSettings();
  const totals = getPeriodTotals(from, to);

  const rows = loadAccounts()
    .map((account) => ({ account, clicks: totals.get(account.name)?.clicks || 0 }))
    .filter((r) => r.clicks > 0)
    .sort((a, b) => b.clicks - a.clicks || a.account.name.localeCompare(b.account.name))
    .map(({ account, clicks }) => (role === 'admin'
      ? { name: account.name, clicks, earnings: Math.round(clicks * rateFor(account, settings) * 100) / 100 }
      : { name: account.name, clicks }));

  return { period: { from, to }, rows };
}

const MAX_MATRIX_DAYS = 120;

/**
 * Clics par clipper et par jour (tableau de chaleur) + total par jour.
 * `from`/`to` sont obligatoires ici (fenêtre bornée à 120 jours).
 * @returns {{days: string[], rows: Array<{name: string, values: number[], total: number}>, totals: number[]}}
 */
export function getDailyMatrix({ from, to }) {
  const days = eachDay(from, to).slice(-MAX_MATRIX_DAYS);
  const index = new Map(days.map((d, i) => [d, i]));
  const perAccount = new Map(loadAccounts().map((a) => [a.name, new Array(days.length).fill(0)]));

  for (const r of getDailyRows(days[0], days[days.length - 1])) {
    const values = perAccount.get(r.account);
    if (values && index.has(r.date)) values[index.get(r.date)] += r.clicks;
  }

  const rows = [...perAccount].map(([name, values]) => ({ name, values, total: values.reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const totals = days.map((_, i) => rows.reduce((s, r) => s + r.values[i], 0));

  return { days, rows, totals };
}
