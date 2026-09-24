import { useMemo, useState } from 'react';

// Sélecteur de période partagé par les pages clippers (Dashboard, page d'un
// clipper, Leaderboard, Jour par jour) : Aujourd'hui / 7 j / 30 j / Tout /
// Custom, comme l'app de référence. Les dates sont celles du fuseau du bot.
const TIMEZONE = 'Europe/Paris';

/** Date du jour (YYYY-MM-DD) dans le fuseau du bot, décalée de `daysAgo` jours. */
export function dateKey(daysAgo = 0) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - daysAgo)).toISOString().slice(0, 10);
}

const last = (days) => () => ({ from: dateKey(days - 1), to: dateKey(0) });

export const PERIODS = {
  today: { label: 'Aujourd’hui', range: last(1) },
  7: { label: '7 j', range: last(7) },
  14: { label: '14 j', range: last(14) },
  30: { label: '30 j', range: last(30) },
  all: { label: 'Tout', range: () => ({ from: null, to: null }) }
};

export const STANDARD_PERIODS = ['today', '7', '30', 'all'];

/**
 * @param {string} defaultKey période active au départ
 * @returns {{key: string, setKey: Function, custom: object, setCustom: Function, range: {from: string|null, to: string|null}, invalid: boolean}}
 */
export function usePeriod(defaultKey = '7') {
  const [key, setKey] = useState(defaultKey);
  const [custom, setCustom] = useState({ from: dateKey(6), to: dateKey(0) });

  const range = useMemo(() => (key === 'custom' ? custom : PERIODS[key].range()), [key, custom]);
  const invalid = Boolean(range.from && range.to && range.from > range.to);

  return { key, setKey, custom, setCustom, range, invalid };
}
