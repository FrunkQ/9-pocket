// Works out which card a piece of text belongs to. The text is either what
// the camera read off a card or what the user typed into search.
//
// Reading stylised card lettering is unreliable, so matching leans on the fact
// that the answer must be one of the cards in the sets on this device: every
// known name is compared with the text loosely (letters wrong, words split or
// run together), and the card number, team and set name add to the score.
import type { Card, Product, Section } from '../types';
import { loadedProducts } from '../data/catalog';
import { TEAMS } from './teams';

export interface Candidate {
  product: Product;
  section: Section;
  card: Card;
  score: number;
  /** How well the name alone agreed, 0 to 1. */
  name: number;
  /** What agreed with the text, for the "matched on" line. */
  evidence: string[];
}

interface Entry {
  product: Product;
  section: Section;
  card: Card;
  nameTokens: string[];
  teamWords: string[];
  setWords: string[];
  sectionWords: string[];
}

export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Words too common in set names to identify one.
const STOP = new Set(['the', 'and', 'of', 'upper', 'deck', 'series', 'set', 'main', 'base', 'hockey', 'edition', 'collection', 'cards']);

let entries: Entry[] = [];
let builtFor = '';

function index(): Entry[] {
  const products = loadedProducts();
  const stamp = products.map((p) => p.id + (p.fetched ?? '')).join(',');
  if (stamp === builtFor) return entries;
  builtFor = stamp;
  entries = [];
  for (const product of products) {
    const setWords = fold(product.name).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
    for (const section of product.sections) {
      const sectionWords = section.id === 'base' ? [] : fold(section.name).split(' ').filter((w) => w.length >= 4 && !STOP.has(w));
      for (const card of section.cards) {
        const nameTokens = fold(card.p).split(' ').filter((t) => t.length >= 2);
        const teamWords = card.t.split('/').flatMap((t) => TEAMS[t]?.words ?? []);
        entries.push({ product, section, card, nameTokens, teamWords, setWords, sectionWords });
      }
    }
  }
  return entries;
}

/** Edit distance, giving up once it passes `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/** Fewest edits needed to find `word` somewhere inside `text` (words run together by the reader). */
function withinDistance(word: string, text: string, max: number): number {
  let prev = new Array<number>(text.length + 1).fill(0);
  for (let i = 1; i <= word.length; i++) {
    const row = [i];
    for (let j = 1; j <= text.length; j++) {
      row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (word[i - 1] === text[j - 1] ? 0 : 1)));
    }
    prev = row;
  }
  let best = max + 1;
  for (const v of prev) if (v < best) best = v;
  return best;
}

/** Text prepared for matching: its words, plus neighbouring words joined (the reader often splits a name). */
export class Reading {
  readonly folded: string;
  readonly words: Set<string>;
  readonly tokens: string[];
  readonly numbers = new Set<number>();
  readonly codes: Set<string>;
  private cache = new Map<string, number>();

  constructor(text: string) {
    this.folded = fold(text);
    const list = this.folded.split(' ').filter(Boolean);
    this.words = new Set(list);
    const tokens = new Set(list.filter((w) => w.length >= 3));
    for (let i = 0; i + 1 < list.length; i++) {
      const joined = list[i] + list[i + 1];
      if (joined.length >= 5 && joined.length <= 18) tokens.add(joined);
    }
    this.tokens = [...tokens];
    for (const w of list) if (/^\d{1,3}$/.test(w)) this.numbers.add(parseInt(w, 10));
    this.codes = new Set(text.toUpperCase().match(/\b[A-Z]{1,5}-[A-Z0-9]{1,4}\b/g) ?? []);
  }

  /** How well a word from a card name appears in the text: 1 exact, lower for near misses, 0 for none. */
  similarity(word: string): number {
    const known = this.cache.get(word);
    if (known !== undefined) return known;
    let best = 0;
    if (this.words.has(word)) {
      best = 1;
    } else if (word.length >= 4) {
      const max = word.length >= 9 ? 3 : word.length >= 6 ? 2 : 1;
      for (const t of this.tokens) {
        let d: number;
        if (t.length > word.length + max) {
          if (word.length < 5) continue;
          d = withinDistance(word, t, max); // Inside a longer run of letters.
          if (d <= max) d += 0.5; // Slightly less convincing than a whole-word match.
        } else {
          d = editDistance(word, t, max);
        }
        if (d > max) continue;
        const sim = 1 - d / word.length;
        if (sim > best) best = sim;
      }
    }
    this.cache.set(word, best);
    return best;
  }
}

function nameScore(e: Entry, reading: Reading): number {
  return nameAgreement(e.nameTokens, e.product.category === 'hockey' || e.product.category === 'baseball', reading);
}

/** Name agreement, 0 to 1. People's names lean on the surname; other names weigh every word. */
export function nameAgreement(tokens: string[], person: boolean, reading: Reading): number {
  if (tokens.length === 0) return 0;
  if (person) {
    const last = tokens[tokens.length - 1];
    const lastSim = reading.similarity(last);
    if (lastSim < 0.6) return 0;
    if (tokens.length === 1) return lastSim;
    let rest = 0;
    for (let i = 0; i < tokens.length - 1; i++) rest += reading.similarity(tokens[i]);
    rest /= tokens.length - 1;
    // A surname alone is accepted when it is long enough not to be noise.
    if (rest === 0 && (last.length < 6 || lastSim < 0.8)) return 0;
    return 0.65 * lastSim + 0.35 * rest;
  }
  let sum = 0;
  let hit = 0;
  for (const t of tokens) {
    const sim = reading.similarity(t);
    sum += sim;
    if (sim >= 0.6) hit++;
  }
  if (hit < Math.ceil(tokens.length * 0.6)) return 0;
  return sum / tokens.length;
}

export interface MatchOptions {
  /** Favour this set, e.g. when scanning from inside its binder. */
  preferProduct?: string;
  limit?: number;
}

/** Ranks the cards in the loaded sets against text read from a photo of a card. */
export function matchText(text: string, options: MatchOptions = {}): Candidate[] {
  const reading = new Reading(text);
  if (reading.tokens.length === 0 && reading.words.size === 0) return [];

  const out: Candidate[] = [];
  for (const e of index()) {
    const name = nameScore(e, reading);
    if (name < 0.55) continue;

    const evidence = ['name'];
    let score = name * 2;

    const cardNumber = /^\d+$/.test(e.card.n) ? parseInt(e.card.n, 10) : NaN;
    if (reading.numbers.has(cardNumber) || reading.codes.has(e.card.n.toUpperCase())) {
      score += 0.6;
      evidence.push('number');
    }
    if (e.teamWords.some((w) => reading.words.has(w))) {
      score += 0.3;
      evidence.push('team');
    }
    if (e.setWords.length && e.setWords.every((w) => reading.words.has(w))) {
      score += 0.4;
      evidence.push('set');
    }
    if (e.sectionWords.length) {
      if (e.sectionWords.every((w) => reading.words.has(w))) {
        score += 0.45;
        evidence.push('subset');
      } else if (e.section.kind === 'insert') {
        score -= 0.3; // Without other evidence, assume the common base card.
      }
    }
    if (options.preferProduct === e.product.id) score += 0.25;

    out.push({ product: e.product, section: e.section, card: e.card, score, name, evidence });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, options.limit ?? 8);
}

/** True when the best match is clear enough to stop reading the card again. */
export function isConfident(candidates: Candidate[]): boolean {
  const best = candidates[0];
  if (!best) return false;
  return best.name >= 0.9 && best.score >= 2.1;
}

/** Typed search: every word must start a word in the name, or be the card number. */
export function searchCards(query: string, options: MatchOptions = {}): Candidate[] {
  const terms = fold(query).split(' ').filter(Boolean);
  if (terms.length === 0) return [];
  const out: Candidate[] = [];
  for (const e of index()) {
    let ok = true;
    let score = 0;
    for (const term of terms) {
      if (/^\d+$/.test(term) && parseInt(e.card.n, 10) === parseInt(term, 10) && /^\d+$/.test(e.card.n)) {
        score += 2;
      } else if (e.nameTokens.some((t) => t.startsWith(term))) {
        score += 1;
      } else if (fold(e.card.n) === term || fold(e.product.name).split(' ').includes(term)) {
        score += 0.5;
      } else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (e.section.kind === 'base') score += 1;
    if (options.preferProduct === e.product.id) score += 0.5;
    out.push({ product: e.product, section: e.section, card: e.card, score, name: 1, evidence: [] });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, options.limit ?? 30);
}
