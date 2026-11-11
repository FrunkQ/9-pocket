// Works out which card a piece of text belongs to. The text is either what
// the camera read off a card or what the user typed into search.
//
// A card front gives us the player name and usually the team; the back adds
// the card number and the set name. Each of those nudges the score, and the
// caller shows the best few candidates for the user to confirm.
import type { Card, Product, Section } from '../types';
import { PRODUCTS } from '../data/catalog';
import { TEAMS } from './teams';

export interface Candidate {
  product: Product;
  section: Section;
  card: Card;
  score: number;
  /** What agreed with the text, for the "matched on" line. */
  evidence: string[];
}

interface Entry {
  product: Product;
  section: Section;
  card: Card;
  nameTokens: string[];
  teamWords: string[];
}

export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Words in a set or section name that identify it when printed on a card.
const PRODUCT_WORDS: Record<string, string[]> = {
  'allure-2025-26': ['allure'],
  'series-1-2025-26': ['series'],
  'mvp-2026-27': ['mvp'],
  'sp-authentic-2023-24': ['authentic'],
};
const SECTION_PHRASES: Record<string, string> = {
  'young-guns': 'young guns',
  'future-watch': 'future watch',
};

let entries: Entry[] | null = null;

function index(): Entry[] {
  if (entries) return entries;
  entries = [];
  for (const product of PRODUCTS) {
    for (const section of product.sections) {
      for (const card of section.cards) {
        const nameTokens = fold(card.p).split(' ').filter((t) => t.length >= 2);
        const teamWords = card.t.split('/').flatMap((t) => TEAMS[t]?.words ?? []);
        entries.push({ product, section, card, nameTokens, teamWords });
      }
    }
  }
  return entries;
}

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

/** 1 for an exact word, less for a near miss (OCR slips), 0 for no match. */
function wordHit(word: string, textWords: Set<string>, textList: string[]): number {
  if (textWords.has(word)) return 1;
  if (word.length < 5) return 0;
  const allowed = word.length >= 8 ? 2 : 1;
  for (const t of textList) {
    if (t.length < 4) continue;
    if (editDistance(word, t, allowed) <= allowed) return 0.7;
  }
  return 0;
}

export interface MatchOptions {
  /** Favour this set, e.g. when scanning from inside its binder. */
  preferProduct?: string;
  limit?: number;
}

/** Ranks cards against text read from a photo of a card. */
export function matchText(text: string, options: MatchOptions = {}): Candidate[] {
  const folded = fold(text);
  const list = folded.split(' ').filter(Boolean);
  const words = new Set(list);
  if (list.length === 0) return [];

  // Card numbers as printed: "100", "No. 100", "CF-12".
  const numbers = new Set(list.filter((w) => /^\d{1,3}$/.test(w)));
  const codes = new Set((text.toUpperCase().match(/\b[A-Z]{1,5}-[A-Z0-9]{1,4}\b/g) ?? []).map((c) => c));

  const out: Candidate[] = [];
  for (const e of index()) {
    if (e.nameTokens.length === 0) continue;
    let hits = 0;
    for (const t of e.nameTokens) hits += wordHit(t, words, list);
    const last = e.nameTokens[e.nameTokens.length - 1];
    const lastHit = wordHit(last, words, list);
    const nameScore = hits / e.nameTokens.length;
    if (lastHit === 0) continue;
    // A surname on its own is enough when it is long enough not to be noise.
    if (nameScore < 0.5 && last.length < 6) continue;

    const evidence = ['name'];
    let score = nameScore * 2;

    if (numbers.has(e.card.n) || codes.has(e.card.n.toUpperCase())) {
      score += 0.6;
      evidence.push('number');
    }
    if (e.teamWords.some((w) => words.has(w))) {
      score += 0.3;
      evidence.push('team');
    }
    if ((PRODUCT_WORDS[e.product.id] ?? []).some((w) => words.has(w))) {
      score += 0.4;
      evidence.push('set');
    }
    const phrase = SECTION_PHRASES[e.section.id];
    if (phrase && folded.includes(phrase)) {
      score += 0.4;
      evidence.push('subset');
    }
    if (e.section.kind === 'insert') {
      const sectionWords = fold(e.section.name).split(' ').filter((w) => w.length >= 4);
      if (sectionWords.length && sectionWords.every((w) => words.has(w))) {
        score += 0.5;
        evidence.push('subset');
      } else {
        score -= 0.3; // Without other evidence, assume the common base card.
      }
    }
    if (options.preferProduct === e.product.id) score += 0.25;

    out.push({ product: e.product, section: e.section, card: e.card, score, evidence });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, options.limit ?? 8);
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
      if (/^\d+$/.test(term) && e.card.n === term) {
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
    out.push({ product: e.product, section: e.section, card: e.card, score, evidence: [] });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, options.limit ?? 30);
}
