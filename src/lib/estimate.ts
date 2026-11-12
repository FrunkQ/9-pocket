// The Guesstimator: what a card is probably worth when there is no real price.
//
// Magic cards carry market prices from Scryfall and those are used as they
// are. Everything else is a guess built from a short list of rules: what kind
// of card it is, how hard it is to get, and how well known the player is.
// The rules are numbers the user can see and change (the Guesstimator page);
// the working for any one card can be shown step by step.
//
// How the rules were set (November 2026):
//
//   The box test. A hobby box of 2025-26 Upper Deck Series 1 costs about
//   $117. Value every card in a box by the rules, using the stated pack
//   odds, and the total should come out at or under the price of the box.
//   The first version of these rules valued the same checklist at $24,000.
//
//   Fame does not multiply everything. A star's base card is worth a few
//   dollars at most. A star's ordinary insert is worth a little more than
//   anyone else's, because stars are in every insert set and those cards are
//   plentiful. Fame counts for most on rookie cards and on scarce cards.
//
//   Scarcity is a price of its own. A card numbered to 99 is worth several
//   dollars whoever is on it, not eight times a ten-cent base card.
//
//   Upper Deck's "Mem/Tech" column marks foil and acetate inserts as well as
//   jersey cards, so it is not read as "a piece of jersey" unless the
//   subset's name says so.
import type { Card, Condition, Copy, Parallel, Product, Section } from '../types';
import { getCard, getProduct, getSection, isOther } from '../data/catalog';
import { formatMoney } from './currency';

export interface Rule {
  id: string;
  group: string;
  label: string;
  /** "$" is an amount in US dollars; "x" multiplies what came before. */
  unit: '$' | 'x';
  value: number;
}

const G1 = 'Starting value, for an ordinary player';
const G2 = 'Well-known players: multiply the starting value';
const G3 = 'Inserts: how hard it is to pull multiplies an ordinary insert';
const G4 = 'Numbered cards: an ordinary player with this print run';
const G5 = 'Versions and condition';

/** The built-in rules. The user's changes are kept in settings and laid over these. */
export const DEFAULT_RULES: Rule[] = [
  { id: 'base', group: G1, label: 'Ordinary base card', unit: '$', value: 0.1 },
  { id: 'premium', group: G1, label: 'Base card in a premium set (SP Authentic, Allure, Ice)', unit: '$', value: 0.5 },
  { id: 'tcg', group: G1, label: 'Pokémon or Magic card with no market price', unit: '$', value: 0.25 },
  { id: 'shortPrint', group: G1, label: 'Short print', unit: '$', value: 0.75 },
  { id: 'youngGuns', group: G1, label: 'Young Guns rookie', unit: '$', value: 3 },
  { id: 'futureWatch', group: G1, label: 'Future Watch rookie', unit: '$', value: 5 },
  { id: 'rookie', group: G1, label: 'Card in any other rookie subset', unit: '$', value: 1.5 },
  { id: 'insert', group: G1, label: 'Ordinary insert', unit: '$', value: 0.5 },
  { id: 'auto', group: G1, label: 'Autograph, at least', unit: '$', value: 8 },
  { id: 'relic', group: G1, label: 'Jersey or relic card, at least', unit: '$', value: 4 },

  { id: 'topBase', group: G2, label: 'Biggest names, on a base card', unit: 'x', value: 10 },
  { id: 'nextBase', group: G2, label: 'Well-known players, on a base card', unit: 'x', value: 2.5 },
  { id: 'topRookie', group: G2, label: 'Biggest names, on their rookie card', unit: 'x', value: 25 },
  { id: 'nextRookie', group: G2, label: 'Well-known players, on their rookie card', unit: 'x', value: 4 },
  { id: 'topInsert', group: G2, label: 'Biggest names, on an ordinary insert', unit: 'x', value: 3 },
  { id: 'nextInsert', group: G2, label: 'Well-known players, on an ordinary insert', unit: 'x', value: 1.5 },
  { id: 'topScarce', group: G2, label: 'Biggest names, on a scarce card (numbered to 199 or fewer, autograph, relic)', unit: 'x', value: 10 },
  { id: 'nextScarce', group: G2, label: 'Well-known players, on a scarce card', unit: 'x', value: 3 },

  { id: 'odds6', group: G3, label: 'One in 6 packs or easier, or odds not stated', unit: 'x', value: 1 },
  { id: 'odds12', group: G3, label: 'One in 7 to 12 packs', unit: 'x', value: 1.5 },
  { id: 'odds30', group: G3, label: 'One in 13 to 30 packs', unit: 'x', value: 2.5 },
  { id: 'odds100', group: G3, label: 'One in 31 to 100 packs', unit: 'x', value: 5 },
  { id: 'odds400', group: G3, label: 'One in 101 to 400 packs', unit: 'x', value: 12 },
  { id: 'odds1500', group: G3, label: 'One in 401 to 1,500 packs', unit: 'x', value: 30 },
  { id: 'oddsMore', group: G3, label: 'Rarer than one in 1,500 packs', unit: 'x', value: 60 },

  { id: 'sn999', group: G4, label: 'Numbered to 999 or more', unit: '$', value: 1.5 },
  { id: 'sn499', group: G4, label: 'Numbered to 499', unit: '$', value: 2 },
  { id: 'sn299', group: G4, label: 'Numbered to 299', unit: '$', value: 3 },
  { id: 'sn199', group: G4, label: 'Numbered to 199', unit: '$', value: 4 },
  { id: 'sn99', group: G4, label: 'Numbered to 99', unit: '$', value: 6 },
  { id: 'sn50', group: G4, label: 'Numbered to 50', unit: '$', value: 10 },
  { id: 'sn25', group: G4, label: 'Numbered to 25', unit: '$', value: 20 },
  { id: 'sn10', group: G4, label: 'Numbered to 10', unit: '$', value: 40 },
  { id: 'sn5', group: G4, label: 'Numbered to 5 or fewer', unit: '$', value: 75 },

  { id: 'finish', group: G5, label: 'A foil, holo or other finish with no print run or odds', unit: 'x', value: 1.6 },
  { id: 'other', group: G5, label: 'A version you named yourself', unit: 'x', value: 2 },
  { id: 'mint', group: G5, label: 'Mint', unit: 'x', value: 1.1 },
  { id: 'excellent', group: G5, label: 'Excellent', unit: 'x', value: 0.6 },
  { id: 'played', group: G5, label: 'Played', unit: 'x', value: 0.3 },
];

let changed: Record<string, number> = {};
let values = new Map(DEFAULT_RULES.map((r) => [r.id, r.value]));

/** Lays the user's changes over the built-in rules. Called by the store whenever settings load or change. */
export function setRules(overrides: Record<string, number> | undefined) {
  changed = overrides ?? {};
  values = new Map(DEFAULT_RULES.map((r) => [r.id, Number.isFinite(changed[r.id]) && changed[r.id] >= 0 ? changed[r.id] : r.value]));
}

/** The rules as they stand now, each with whether the user has changed it. */
export function currentRules(): (Rule & { original: number })[] {
  return DEFAULT_RULES.map((r) => ({ ...r, original: r.value, value: values.get(r.id) ?? r.value }));
}

const rule = (id: string) => values.get(id) ?? 0;

// ---- Who counts as well known -------------------------------------------------

export const STARS_TOP = [
  'connor mcdavid', 'connor bedard', 'sidney crosby', 'alex ovechkin', 'nathan mackinnon', 'auston matthews',
  'macklin celebrini', 'cale makar', 'wayne gretzky', 'matvei michkov', 'ivan demidov', 'matthew schaefer',
  'lane hutson', 'michael misa',
];
export const STARS_NEXT = [
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

type Tier = 'top' | 'next' | '';
function tierOf(name: string): Tier {
  const key = fold(name);
  return TOP.has(key) ? 'top' : NEXT.has(key) ? 'next' : '';
}

/** What kind of card the fame multiplier is being applied to. */
type Kind = 'Base' | 'Rookie' | 'Insert' | 'Scarce';

function fame(tier: Tier, kind: Kind): number {
  return tier === '' ? 1 : rule((tier === 'top' ? 'top' : 'next') + kind);
}

// ---- Scarcity -------------------------------------------------------------------

/** An ordinary player's card with this print run, in dollars. */
function printRunValue(sn: number): number {
  if (sn <= 5) return rule('sn5');
  if (sn <= 10) return rule('sn10');
  if (sn <= 25) return rule('sn25');
  if (sn <= 50) return rule('sn50');
  if (sn <= 100) return rule('sn99');
  if (sn <= 199) return rule('sn199');
  if (sn <= 299) return rule('sn299');
  if (sn <= 499) return rule('sn499');
  return rule('sn999');
}

/** Packs per card, from the first "1:N" in the stated odds. 0 when none is stated. */
function packsPer(odds: string | undefined): number {
  const m = odds?.replace(/,/g, '').match(/1:(\d+)/);
  return m ? Number(m[1]) : 0;
}

function oddsMultiplier(odds: string | undefined): number {
  const n = packsPer(odds);
  if (n <= 6) return rule('odds6');
  if (n <= 12) return rule('odds12');
  if (n <= 30) return rule('odds30');
  if (n <= 100) return rule('odds100');
  if (n <= 400) return rule('odds400');
  if (n <= 1500) return rule('odds1500');
  return rule('oddsMore');
}

const oddsText = (odds: string | undefined) => {
  const n = packsPer(odds);
  return n ? `1 in ${n.toLocaleString('en-US')} packs` : 'odds not stated';
};

// A subset whose name says it holds a piece of something worn or used.
const RELIC = /jersey|relic|patch|material|fabric|sweater|thread|swatch|memorabilia|game[- ]used|remnant|laundry|\btag\b|booklet/i;
const ROOKIE_SUBSET = /rookie|young guns|future watch|prospect|debut|premiere|freshman|first year/i;
const PREMIUM_SET = /sp authentic|allure|\bice\b|black diamond|ultimate|the cup|premier|\bspx\b|sp game used|artifacts|trilogy|clear cut|stature|synergy|credentials|engrained|chronology/i;
/** Finishes of card-game cards that are neither numbered nor given pack odds. */
const FINISH: Record<string, number> = { foil: 1.6, etched: 2, reverse: 1.5, holo: 2, 'first-edition': 4 };

/**
 * Some subsets come in print-run tiers named by the number alone
 * ("Population Count 100", "... 25", "... 1"). Where three or more subsets
 * share a name and the numbers reach 25 or more, the number is the print run.
 */
const tiers = new WeakMap<Product, Map<string, number>>();
function tierPrintRun(product: Product, section: Section): number | undefined {
  let map = tiers.get(product);
  if (!map) {
    map = new Map();
    const families = new Map<string, { id: string; n: number }[]>();
    for (const s of product.sections) {
      const m = /^(.*\D)\s(\d+)$/.exec(s.name);
      if (!m) continue;
      const family = families.get(m[1]) ?? [];
      family.push({ id: s.id, n: Number(m[2]) });
      families.set(m[1], family);
    }
    for (const family of families.values()) {
      if (family.length >= 3 && family.some((f) => f.n >= 25)) for (const f of family) map.set(f.id, f.n);
    }
    tiers.set(product, map);
  }
  return map.get(section.id);
}

function round(value: number): number {
  if (value < 1) return Math.max(0.05, Math.round(value * 20) / 20);
  if (value < 10) return Math.round(value * 4) / 4;
  if (value < 100) return Math.round(value);
  return Math.round(value / 5) * 5;
}

function findParallel(product: Product, section: Section, versionId: string): Parallel | undefined {
  const pool = section.kind === 'base' ? product.parallels : section.parallels ?? [];
  return pool.find((p) => p.id === versionId);
}

const usd = (n: number) => '$' + n.toFixed(2);

export interface Working {
  /** The value in US dollars, or null where a guess would be meaningless (one-of-one cards). */
  value: number | null;
  /** True when the value is a market price from the data source rather than a guess. */
  real: boolean;
  /** One line per rule applied, in order. */
  steps: string[];
}

/** Works out a card's value and says how. */
export function explain(product: Product, section: Section, card: Card, versionId = 'base', condition: Condition = 'NM'): Working {
  const conditionRule = condition === 'M' ? rule('mint') : condition === 'EX' ? rule('excellent') : condition === 'PL' ? rule('played') : 1;
  const conditionName = condition === 'M' ? 'Mint' : condition === 'EX' ? 'Excellent' : condition === 'PL' ? 'Played' : 'Near mint';

  const real = marketPrice(card, versionId);
  if (real !== undefined) {
    return { value: Math.round(real * conditionRule * 100) / 100, real: true, steps: [`Market price from the card database: ${usd(real)}`, `${conditionName}: x${conditionRule}`] };
  }

  // A version the checklist does not list: a multiple of the plain card.
  if (isOther(versionId)) {
    const plain = explain(product, section, card, 'base', condition);
    if (plain.value === null) return plain;
    return { value: round(plain.value * rule('other')), real: false, steps: [...plain.steps, `A version you named yourself: x${rule('other')}`] };
  }

  const steps: string[] = [];
  const sn = card.sn ?? tierPrintRun(product, section);
  if (sn === 1) return { value: null, real: false, steps: ['One of one: no guess is made'] };

  const tier = tierOf(card.p);
  const imported = product.id.startsWith('imp-');
  const cardGame = product.category === 'mtg' || product.category === 'pokemon';
  let value: number;
  let kind: Kind;

  if (section.kind === 'base') {
    if (section.id === 'young-guns') {
      value = rule('youngGuns');
      kind = 'Rookie';
      steps.push(`Young Guns rookie: ${usd(value)}`);
    } else if (section.id === 'future-watch') {
      value = rule('futureWatch');
      kind = 'Rookie';
      steps.push(`Future Watch rookie: ${usd(value)}`);
    } else if (section.id !== 'base' && ROOKIE_SUBSET.test(section.name)) {
      value = rule('rookie');
      kind = 'Rookie';
      steps.push(`Rookie subset card: ${usd(value)}`);
    } else if (section.id !== 'base' && /short print|\bsps?\b/i.test(section.name)) {
      value = rule('shortPrint');
      kind = 'Base';
      steps.push(`Short print: ${usd(value)}`);
    } else if (cardGame) {
      value = rule('tcg');
      kind = 'Base';
      steps.push(`Card with no market price: ${usd(value)}`);
    } else if (PREMIUM_SET.test(product.name)) {
      value = rule('premium');
      kind = 'Base';
      steps.push(`Base card in a premium set: ${usd(value)}`);
    } else {
      value = rule('base');
      kind = 'Base';
      steps.push(`Ordinary base card: ${usd(value)}`);
    }
  } else {
    const hard = oddsMultiplier(section.odds);
    value = rule('insert') * hard;
    kind = 'Insert';
    steps.push(`Ordinary insert: ${usd(rule('insert'))}`);
    if (hard !== 1) steps.push(`Pulled ${oddsText(section.odds)}: x${hard}`);
  }

  if (sn) {
    const numbered = printRunValue(sn);
    if (numbered > value) {
      value = numbered;
      steps.push(`Numbered to ${sn}: ${usd(numbered)} instead`);
    }
    if (sn <= 199) kind = 'Scarce';
  }
  if (card.au) {
    const signed = Math.max(value * 1.5, rule('auto'));
    steps.push(`Autograph: ${usd(signed)} (half as much again, and at least ${usd(rule('auto'))})`);
    value = signed;
    kind = 'Scarce';
  }
  // Upper Deck's "Mem/Tech" mark alone is not proof of a jersey piece; the subset's name is.
  if (RELIC.test(section.name) || (card.mem && imported)) {
    if (rule('relic') > value) {
      value = rule('relic');
      steps.push(`Jersey or relic card: at least ${usd(value)}`);
    }
    kind = 'Scarce';
  }

  const famous = fame(tier, kind);
  if (famous !== 1) {
    value *= famous;
    steps.push(`${tier === 'top' ? 'One of the biggest names' : 'A well-known player'}, on ${kind === 'Base' ? 'a base card' : kind === 'Rookie' ? 'a rookie card' : kind === 'Insert' ? 'an ordinary insert' : 'a scarce card'}: x${famous}`);
  }

  if (versionId !== 'base') {
    const parallel = findParallel(product, section, versionId);
    if (parallel) {
      if (parallel.sn === 1) return { value: null, real: false, steps: ['One of one: no guess is made'] };
      if (parallel.sn) {
        // Whichever is more: this print run's own price (times fame), or the
        // plain card grown in step with how much scarcer it is than /999.
        const floor = printRunValue(parallel.sn) * fame(tier, parallel.sn <= 199 ? 'Scarce' : 'Insert');
        const grown = value * (printRunValue(parallel.sn) / rule('sn999'));
        value = Math.max(floor, grown);
        steps.push(`${parallel.name}, numbered to ${parallel.sn}: ${usd(value)}`);
      } else if (FINISH[parallel.id]) {
        value *= FINISH[parallel.id];
        steps.push(`${parallel.name}: x${FINISH[parallel.id]}`);
      } else if (packsPer(parallel.odds)) {
        const hard = oddsMultiplier(parallel.odds);
        const floor = rule('insert') * hard * fame(tier, 'Insert');
        const grown = value * (1 + (hard - 1) / 2);
        value = Math.max(floor, grown);
        steps.push(`${parallel.name}, pulled ${oddsText(parallel.odds)}: ${usd(value)}`);
      } else {
        value *= rule('finish');
        steps.push(`${parallel.name}: x${rule('finish')}`);
      }
      if (parallel.au && !card.au) {
        value = Math.max(value * 1.5, rule('auto') * fame(tier, 'Scarce'));
        steps.push(`Autographed version: ${usd(value)}`);
      }
      if (parallel.mem && !card.mem && RELIC.test(parallel.name)) {
        value = Math.max(value, rule('relic') * fame(tier, 'Scarce'));
        steps.push(`Jersey or relic version: at least ${usd(value)}`);
      }
    }
  }

  if (conditionRule !== 1) steps.push(`${conditionName}: x${conditionRule}`);
  const total = round(value * conditionRule);
  steps.push(`Rounded: ${usd(total)}`);
  return { value: total, real: false, steps };
}

/**
 * Estimated value of one card in one version and condition, in US dollars.
 * Returns null where a guess would be meaningless (one-of-one cards).
 */
export function estimate(product: Product, section: Section, card: Card, versionId = 'base', condition: Condition = 'NM'): number | null {
  return explain(product, section, card, versionId, condition).value;
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
