// Placeholder valuation.
//
// There is no live price feed yet, so every value the app shows is a blanket
// estimate built from what kind of card it is: which set, which section,
// how well known the player is, how scarce the version is, and its condition.
// The numbers below are starting guesses, not market data. They are all in
// one place so they can be tuned, or replaced card by card once real sold
// prices are available. The UI marks every estimate with a "~".
import type { Card, Condition, Copy, Parallel, Product, Section } from '../types';
import { getCard, getProduct, getSection, isOther } from '../data/catalog';
import { formatMoney } from './currency';

/** Typical price of an ordinary base card in each set, in US dollars. */
const PRODUCT_BASE: Record<string, number> = {
  'allure-2025-26': 0.75,
  'series-1-2025-26': 0.5,
  'mvp-2026-27': 0.25,
  'sp-authentic-2023-24': 1,
};

/** Sections that are worth more than the set's ordinary base card. */
const SECTION_BASE: Record<string, Record<string, number>> = {
  'allure-2025-26': { rookies: 2 },
  'mvp-2026-27': { 'short-prints': 1, rookies: 0.75 },
};
/** The same, for any set that has a section by this name. */
const SECTION_DEFAULT: Record<string, number> = { 'young-guns': 4, 'future-watch': 8, rookies: 2, 'short-prints': 1, 'secret-rares': 12 };
/** Typical base card where the set is not listed above, by kind of card. */
const CATEGORY_BASE: Record<string, number> = { hockey: 0.5, mtg: 0.25, pokemon: 0.4, baseball: 0.5 };
/** Simple finishes that are neither numbered nor given pack odds. */
const FINISH: Record<string, number> = { foil: 1.6, etched: 2, reverse: 1.5, holo: 2, 'first-edition': 4 };

const STARS_TOP = [
  'connor mcdavid', 'connor bedard', 'sidney crosby', 'alex ovechkin', 'nathan mackinnon', 'auston matthews',
  'macklin celebrini', 'cale makar', 'wayne gretzky', 'matvei michkov', 'ivan demidov', 'matthew schaefer',
  'lane hutson', 'michael misa',
];
const STARS_NEXT = [
  'leon draisaitl', 'nikita kucherov', 'david pastrnak', 'jack hughes', 'quinn hughes', 'kirill kaprizov',
  'mitch marner', 'mikko rantanen', 'artemi panarin', 'aleksander barkov', 'matthew tkachuk', 'brady tkachuk',
  'brayden point', 'steven stamkos', 'anze kopitar', 'evgeni malkin', 'connor hellebuyck', 'igor shesterkin',
  'andrei vasilevskiy', 'sergei bobrovsky', 'adam fox', 'roman josi', 'victor hedman', 'jack eichel',
  'tim stutzle', 'nick suzuki', 'cole caufield', 'jason robertson', 'william nylander', 'sebastian aho',
  'sam reinhart', 'adam fantilli', 'leo carlsson', 'logan cooley', 'wyatt johnston', 'moritz seider',
  'lucas raymond', 'juraj slafkovsky', 'luke hughes', 'elias pettersson', 'mark scheifele', 'kyle connor',
  'jake guentzel', 'zach werenski', 'rasmus dahlin', 'tage thompson', 'mario lemieux', 'patrick roy',
  'will smith', 'cutter gauthier', 'dustin wolf', 'ryan leonard', 'zayne parekh', 'jimmy snuggerud',
  'gabe perreault', 'artyom levshunov', 'zeev buium', 'sam dickinson', 'easton cowan', 'beckett sennecke',
];

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const TOP = new Set(STARS_TOP);
const NEXT = new Set(STARS_NEXT);

function playerMultiplier(name: string): number {
  const key = fold(name);
  if (TOP.has(key)) return 8;
  if (NEXT.has(key)) return 3;
  return 1;
}

/** Scarcity by print run. */
function serialMultiplier(sn: number): number {
  if (sn <= 5) return 150;
  if (sn <= 10) return 60;
  if (sn <= 25) return 30;
  if (sn <= 35) return 25;
  if (sn <= 50) return 18;
  if (sn <= 100) return 12;
  if (sn <= 199) return 7;
  if (sn <= 299) return 5;
  if (sn <= 399) return 4;
  if (sn <= 999) return 2.5;
  return 1.5;
}

/** Scarcity by pack odds, read from the first "1:N" in the stated odds. */
function oddsMultiplier(odds: string | undefined): number {
  const m = odds?.replace(/,/g, '').match(/1:(\d+)/);
  if (!m) return 3;
  const n = Number(m[1]);
  if (n <= 2) return 1.5;
  if (n <= 5) return 2;
  if (n <= 12) return 3;
  if (n <= 30) return 5;
  if (n <= 100) return 10;
  if (n <= 400) return 25;
  if (n <= 1500) return 60;
  return 120;
}

const CONDITION: Record<Condition, number> = { M: 1.15, NM: 1, EX: 0.6, PL: 0.3 };

function round(value: number): number {
  if (value < 2) return Math.max(0.25, Math.round(value * 4) / 4);
  if (value < 20) return Math.round(value * 2) / 2;
  if (value < 100) return Math.round(value);
  return Math.round(value / 5) * 5;
}

function findParallel(product: Product, section: Section, versionId: string): Parallel | undefined {
  const pool = section.kind === 'base' ? product.parallels : section.parallels ?? [];
  return pool.find((p) => p.id === versionId);
}

/**
 * Estimated value of one card in one version and condition, in US dollars.
 * Returns null where a guess would be meaningless (one-of-one cards).
 */
export function estimate(product: Product, section: Section, card: Card, versionId = 'base', condition: Condition = 'NM'): number | null {
  // A version the checklist does not list: guess at a few times the base card.
  if (isOther(versionId)) {
    const base = estimate(product, section, card, 'base', condition);
    return base === null ? null : round(base * 3);
  }
  const real = marketPrice(card, versionId);
  if (real !== undefined) return Math.round(real * CONDITION[condition] * 100) / 100;
  if (card.sn === 1) return null;
  const setBase = PRODUCT_BASE[product.id] ?? CATEGORY_BASE[product.category] ?? 0.5;

  let value: number;
  if (section.kind === 'base') {
    value = SECTION_BASE[product.id]?.[section.id] ?? SECTION_DEFAULT[section.id] ?? setBase;
    if (card.sn) value = Math.max(value, setBase * serialMultiplier(card.sn));
    if (card.au) value *= 3;
  } else {
    value = setBase * (card.sn ? serialMultiplier(card.sn) : oddsMultiplier(section.odds));
    if (card.au) value = Math.max(value * 4, 12);
    if (card.mem) value = Math.max(value * 2, 8);
    if (card.rc) value *= 1.5;
  }
  value *= playerMultiplier(card.p);

  if (versionId !== 'base') {
    const parallel = findParallel(product, section, versionId);
    if (parallel) {
      if (parallel.sn === 1) return null;
      value *= parallel.sn ? serialMultiplier(parallel.sn) : FINISH[parallel.id] ?? oddsMultiplier(parallel.odds);
      if (parallel.au && !card.au) value = Math.max(value * 4, 12);
      if (parallel.mem && !card.mem) value = Math.max(value * 2, 8);
    }
  }

  return round(value * CONDITION[condition]);
}

/** A real market price from the data source, when the card has one for this version. */
export function marketPrice(card: Card, versionId = 'base'): number | undefined {
  if (isOther(versionId)) return undefined;
  return versionId === 'base' ? card.pr : card.vp?.[versionId];
}

/** The value as text: "$1.20" for a market price, "~$1.25" for an estimate. */
export function priceText(product: Product, section: Section, card: Card, versionId = 'base', condition: Condition = 'NM'): string {
  const value = estimate(product, section, card, versionId, condition);
  if (value === null) return 'one of one';
  return (marketPrice(card, versionId) !== undefined ? '' : '~') + formatMoney(value);
}

/** Estimated value of a copy the user owns; 0 when it cannot be estimated. */
export function copyValue(copy: Copy): number {
  const product = getProduct(copy.product);
  const section = product && getSection(product, copy.section);
  const card = section && getCard(section, copy.n);
  if (!product || !section || !card) return 0;
  return estimate(product, section, card, copy.version, copy.condition) ?? 0;
}

export function money(value: number | null): string {
  if (value === null) return 'one of one';
  return `~${formatMoney(value)}`;
}

export function moneyTotal(value: number): string {
  return `~${formatMoney(value)}`;
}
