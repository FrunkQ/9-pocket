// "Which set is this card from?" for cards whose set is not on the device yet.
//
//   Hockey   A player index shipped with the catalogue says which sets each
//            player appears in; the text read off the card picks the player.
//   Magic    Scryfall finds the card by (roughly read) name and lists its printings.
//   Pokémon  TCGdex searches cards by name.
//
// The result is a short list of sets to add, most likely first.
import type { Category, SetInfo } from '../types';
import { listSets } from '../data/catalog';
import { fold, nameAgreement, Reading } from './match';

export interface SetHit {
  set: SetInfo;
  /** The card found in that set. */
  cardName: string;
  n?: string;
  img?: string;
  score: number;
  /** The card itself names this set or one of its subsets, rather than only the player being in it. */
  sure?: boolean;
  /** The subset name read off the card, e.g. "Rookie Authentics". */
  part?: string;
}

/** Lines of the reading that could be a card's name, longest-looking first in reading order. */
function nameLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/[^A-Za-z',\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (line.length < 4 || line.length > 40) continue;
    const letters = line.replace(/[^A-Za-z]/g, '').length;
    if (letters < 4 || letters / line.length < 0.7) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

// ---- Hockey ---------------------------------------------------------------

let playersJob: Promise<Record<string, number[]>> | null = null;

function players(): Promise<Record<string, number[]>> {
  if (!playersJob) {
    playersJob = fetch('catalog/hockey/players.json').then((r) => (r.ok ? r.json() : {}));
    playersJob.catch(() => {
      playersJob = null;
    });
  }
  return playersJob;
}

let subsetsJob: Promise<Record<string, number[]>> | null = null;

/** Named parts of base sets ("rookie authentics") and the sets that have one. Optional: empty if it will not load. */
function subsets(): Promise<Record<string, number[]>> {
  if (!subsetsJob) {
    subsetsJob = fetch('catalog/hockey/subsets.json')
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, number[]>>) : {}))
      .catch(() => ({}));
  }
  return subsetsJob;
}

async function hockey(text: string): Promise<SetHit[]> {
  const [index, sets, parts] = await Promise.all([players(), listSets('hockey'), subsets()]);
  const reading = new Reading(text);

  // Subset names printed on the card, e.g. "ROOKIE AUTHENTICS". The lettering
  // is often run together or a letter out, so near misses count.
  const printed = new Map<number, string>();
  for (const part of Object.keys(parts)) {
    const words = part.split(' ').filter((w) => w.length >= 4);
    if (words.length === 0 || part.split(' ').length > words.length + 1) continue;
    // One common word ("rookies") is not enough to tell sets apart.
    if (words.length < 2 && words[0].length < 9) continue;
    if (!words.every((w) => reading.similarity(w) >= 0.8)) continue;
    for (const position of parts[part]) {
      if ((printed.get(position)?.length ?? 0) < part.length) printed.set(position, part);
    }
  }

  const found: { name: string; score: number; sets: number[] }[] = [];
  for (const name of Object.keys(index)) {
    const score = nameAgreement(name.split(' '), true, reading);
    if (score >= 0.7) found.push({ name, score, sets: index[name] });
  }
  found.sort((a, b) => b.score - a.score);

  const padded = ` ${reading.folded} `;
  const sectionTitle = (part: string) => part.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const hits = new Map<string, SetHit>();
  // Other players only when their names read about as well as the best one.
  for (const player of found.filter((p) => p.score >= found[0].score - 0.1).slice(0, 3)) {
    for (const position of player.sets) {
      const set = sets[position];
      if (!set) continue;
      let score = player.score;
      let sure = false;
      // The set's own name, or its season, printed on the card settles it.
      // Card backs print the product line: "2025-26 SP HOCKEY".
      const name = fold(set.name);
      const words = name.split(' ').filter((w) => w.length >= 2);
      if (padded.includes(` ${name} hockey `)) {
        score += 0.9;
        sure = true;
      } else if (words.length && words.every((w) => reading.words.has(w))) {
        score += 0.5;
        sure = name.length >= 5;
      }
      const part = printed.get(position);
      if (part) {
        score += 0.6;
        sure = true;
      }
      const [from, to] = set.season.split('-');
      if (from && reading.words.has(from)) score += 0.3;
      if (to && (reading.folded.includes(`${from.slice(2)} ${to}`) || reading.folded.includes(`${from} ${to}`))) score += 0.3;
      const cardName = player.name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
      const existing = hits.get(set.id);
      if (!existing || existing.score < score) hits.set(set.id, { set, cardName, score, sure, part: part ? sectionTitle(part) : undefined });
    }
  }
  // Ties fall back to catalogue order, which is newest first. A player can be
  // in twenty sets in a season; when the card does not say which, show them all.
  return [...hits.values()].sort((a, b) => b.score - a.score || sets.indexOf(a.set) - sets.indexOf(b.set)).slice(0, 24);
}

// ---- Magic ----------------------------------------------------------------

interface ScryNamed {
  name: string;
  prints_search_uri: string;
}
interface ScryPrint {
  set: string;
  set_name: string;
  collector_number: string;
  released_at?: string;
  digital?: boolean;
  image_uris?: { small: string };
  card_faces?: { image_uris?: { small: string } }[];
}

async function magic(text: string): Promise<SetHit[]> {
  const sets = new Map((await listSets('mtg')).map((s) => [s.id, s]));
  for (const line of nameLines(text).slice(0, 5)) {
    const res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(line)}`, { headers: { Accept: 'application/json' } });
    await new Promise((r) => setTimeout(r, 120));
    if (!res.ok) continue;
    const card = (await res.json()) as ScryNamed;
    const prints = await fetch(card.prints_search_uri, { headers: { Accept: 'application/json' } });
    if (!prints.ok) continue;
    const data = ((await prints.json()) as { data: ScryPrint[] }).data;
    const reading = new Reading(text);
    const hits: SetHit[] = [];
    for (const p of data) {
      const set = sets.get(`mtg-${p.set}`);
      if (!set || p.digital) continue;
      // The collector number, printed bottom-left, picks the exact printing.
      const number = parseInt(p.collector_number, 10);
      const score = 1 + (reading.numbers.has(number) ? 0.5 : 0) + (reading.words.has(p.set) ? 0.5 : 0);
      hits.push({ set, cardName: card.name, n: p.collector_number, img: p.image_uris?.small ?? p.card_faces?.[0]?.image_uris?.small, score });
    }
    if (hits.length) return hits.sort((a, b) => b.score - a.score).slice(0, 12);
  }
  return [];
}

// ---- Pokémon ----------------------------------------------------------------

interface DexCard {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

async function pokemon(text: string): Promise<SetHit[]> {
  const sets = new Map((await listSets('pokemon')).map((s) => [s.id, s]));
  const reading = new Reading(text);
  for (const line of nameLines(text).slice(0, 5)) {
    const res = await fetch(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(line)}`);
    if (!res.ok) continue;
    const cards = (await res.json()) as DexCard[];
    if (!Array.isArray(cards) || cards.length === 0) continue;
    const hits: SetHit[] = [];
    for (const c of cards) {
      const setId = c.id.slice(0, c.id.length - c.localId.length - 1);
      const set = sets.get(`pkm-${setId}`);
      if (!set) continue;
      const number = parseInt(c.localId, 10);
      const score = 1 + (reading.numbers.has(number) ? 0.5 : 0) + (fold(c.name) === fold(line) ? 0.3 : 0);
      hits.push({ set, cardName: c.name, n: c.localId, img: c.image ? `${c.image}/low.webp` : undefined, score });
    }
    // Newest sets are listed first in the catalogue.
    const order = [...sets.keys()];
    if (hits.length) return hits.sort((a, b) => b.score - a.score || order.indexOf(a.set.id) - order.indexOf(b.set.id)).slice(0, 12);
  }
  return [];
}

/** Sets the card in this text could belong to, most likely first. Empty when nothing is found. */
export async function findSets(text: string, category: Category): Promise<SetHit[]> {
  try {
    if (category === 'hockey') return await hockey(text);
    if (category === 'mtg') return await magic(text);
    if (category === 'pokemon') return await pokemon(text);
  } catch {
    // Offline or the source is down: nothing to suggest.
  }
  return [];
}
