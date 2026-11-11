// Where sets come from, per kind of card.
//
//   Hockey   Checklists built from Upper Deck's published pages, shipped with
//            the app as static files under catalog/hockey/ and fetched on demand.
//   Magic    Scryfall's public API: every set, with card images and prices.
//   Pokémon  TCGdex's public API: every set, with card images.
//
// Each provider can list its sets and download one as a Product.
import type { Card, Category, Parallel, Product, Section, SetInfo } from '../types';

export interface Provider {
  list(): Promise<SetInfo[]>;
  load(id: string): Promise<Product | null>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string, headers?: Record<string, string>): Promise<T | null> {
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

// ---- Hockey -------------------------------------------------------------

const hockey: Provider = {
  async list() {
    return (await getJson<SetInfo[]>('catalog/hockey/index.json')) ?? [];
  },
  async load(id) {
    return getJson<Product>(`catalog/hockey/${encodeURIComponent(id)}.json`);
  },
};

// ---- Magic: The Gathering (Scryfall) --------------------------------------

interface ScrySet {
  code: string;
  name: string;
  set_type: string;
  released_at?: string;
  card_count: number;
  printed_size?: number;
  digital: boolean;
  icon_svg_uri?: string;
}
interface ScryFace {
  image_uris?: { small: string; normal: string };
}
interface ScryCard {
  name: string;
  collector_number: string;
  rarity: string;
  type_line?: string;
  finishes?: string[];
  prices?: { usd: string | null; usd_foil: string | null; usd_etched: string | null };
  image_uris?: { small: string; normal: string };
  card_faces?: ScryFace[];
}
interface ScryList<T> {
  data: T[];
  has_more?: boolean;
  next_page?: string;
}

const SCRYFALL = 'https://api.scryfall.com';
const SCRY_HEADERS = { Accept: 'application/json' };
// The kinds of set people collect; promos, tokens and digital-only sets are left out.
const MTG_TYPES = new Set(['expansion', 'core', 'masters', 'draft_innovation', 'commander', 'funny', 'starter', 'eternal']);

const price = (v: string | null | undefined) => {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const mtg: Provider = {
  async list() {
    const sets = await getJson<ScryList<ScrySet>>(`${SCRYFALL}/sets`, SCRY_HEADERS);
    return (sets?.data ?? [])
      .filter((s) => MTG_TYPES.has(s.set_type) && !s.digital && s.card_count > 0)
      .map((s) => ({ id: `mtg-${s.code}`, category: 'mtg' as Category, name: s.name, brand: 'Magic', season: (s.released_at ?? '').slice(0, 4), count: s.card_count, icon: s.icon_svg_uri }));
  },
  async load(id) {
    const code = id.replace(/^mtg-/, '');
    const set = await getJson<ScrySet>(`${SCRYFALL}/sets/${encodeURIComponent(code)}`, SCRY_HEADERS);
    if (!set) return null;

    const all: ScryCard[] = [];
    let url: string | undefined = `${SCRYFALL}/cards/search?q=${encodeURIComponent(`e:${code}`)}&unique=prints&order=set&include_extras=true&include_variations=true`;
    while (url) {
      const page: ScryList<ScryCard> | null = await getJson<ScryList<ScryCard>>(url, SCRY_HEADERS);
      if (!page) break;
      all.push(...page.data);
      url = page.has_more ? page.next_page : undefined;
      if (url) await sleep(120); // Scryfall asks for a short pause between requests.
    }
    if (all.length === 0) return null;

    const main: Card[] = [];
    const extras: Card[] = [];
    const foil: string[] = [];
    const etched: string[] = [];
    // After the main run, a set repeats its cards as showcase, borderless and
    // extended-art variants. Without a printed set size, the first appearance
    // of each name is the main card and later ones are variants.
    const seenNames = new Set<string>();
    for (const c of all) {
      const images = c.image_uris ?? c.card_faces?.[0]?.image_uris;
      const finishes = c.finishes ?? ['nonfoil'];
      const card: Card = { n: c.collector_number, p: c.name, t: '', sub: [c.rarity, c.type_line].filter(Boolean).join(' · ') };
      if (images) {
        card.img = images.small;
        card.imgL = images.normal;
      }
      const base = price(c.prices?.usd);
      if (base) card.pr = base;
      const vp: Record<string, number> = {};
      const foilPrice = price(c.prices?.usd_foil);
      const etchedPrice = price(c.prices?.usd_etched);
      if (foilPrice) vp.foil = foilPrice;
      if (etchedPrice) vp.etched = etchedPrice;
      if (Object.keys(vp).length) card.vp = vp;
      if (!finishes.includes('nonfoil')) card.po = 1; // Only printed in foil.
      if (finishes.includes('foil')) foil.push(card.n);
      if (finishes.includes('etched')) etched.push(card.n);
      const number = parseInt(c.collector_number, 10);
      const basicLand = (c.type_line ?? '').startsWith('Basic Land');
      const inMain = set.printed_size ? /^\d+$/.test(c.collector_number) && number <= set.printed_size : basicLand || !seenNames.has(c.name);
      seenNames.add(c.name);
      (inMain ? main : extras).push(card);
    }

    const sections: Section[] = [{ id: 'base', name: 'Main set', kind: 'base', cards: main.length ? main : extras }];
    if (main.length && extras.length) sections.push({ id: 'ins-extras', name: 'Variants and extras', kind: 'insert', cards: extras, parallels: [] });
    const parallels: Parallel[] = [];
    const total = all.length;
    if (foil.length) parallels.push({ id: 'foil', name: 'Foil', ...(foil.length === total ? {} : { cards: foil }) });
    if (etched.length) parallels.push({ id: 'etched', name: 'Etched foil', ...(etched.length === total ? {} : { cards: etched }) });
    // Extras share the same finishes.
    for (const s of sections) if (s.kind === 'insert') s.parallels = parallels;

    return { id, category: 'mtg', name: set.name, brand: 'Magic', season: (set.released_at ?? '').slice(0, 4), source: `https://scryfall.com/sets/${code}`, fetched: new Date().toISOString(), sections, parallels };
  },
};

// ---- Pokémon (TCGdex) ------------------------------------------------------

interface DexSetBrief {
  id: string;
  name: string;
  cardCount?: { total?: number; official?: number };
}
interface DexSet extends DexSetBrief {
  releaseDate?: string;
  cardCount?: { total?: number; official?: number; reverse?: number; holo?: number; firstEd?: number };
  cards?: { id: string; localId: string; name: string; image?: string }[];
}

const TCGDEX = 'https://api.tcgdex.net/v2/en';

const pokemon: Provider = {
  async list() {
    const sets = (await getJson<DexSetBrief[]>(`${TCGDEX}/sets`)) ?? [];
    // The source lists oldest first; collectors usually want the newest.
    return sets
      .filter((s) => (s.cardCount?.total ?? 0) > 0)
      .reverse()
      .map((s) => ({ id: `pkm-${s.id}`, category: 'pokemon' as Category, name: s.name, brand: 'Pokémon', season: '', count: s.cardCount?.total ?? 0 }));
  },
  async load(id) {
    const code = id.replace(/^pkm-/, '');
    const set = await getJson<DexSet>(`${TCGDEX}/sets/${encodeURIComponent(code)}`);
    if (!set?.cards?.length) return null;
    const official = set.cardCount?.official ?? set.cards.length;

    const main: Card[] = [];
    const secret: Card[] = [];
    for (const c of set.cards) {
      const card: Card = { n: c.localId, p: c.name, t: '' };
      if (c.image) {
        card.img = `${c.image}/low.webp`;
        card.imgL = `${c.image}/high.webp`;
      }
      const number = parseInt(c.localId, 10);
      (/^\d+$/.test(c.localId) && number > official ? secret : main).push(card);
    }
    const sections: Section[] = [{ id: 'base', name: 'Main set', kind: 'base', cards: main }];
    if (secret.length) sections.push({ id: 'secret-rares', name: 'Secret rares', kind: 'base', cards: secret });

    const parallels: Parallel[] = [];
    if (set.cardCount?.reverse) parallels.push({ id: 'reverse', name: 'Reverse holo' });
    if (set.cardCount?.holo) parallels.push({ id: 'holo', name: 'Holo' });
    if (set.cardCount?.firstEd) parallels.push({ id: 'first-edition', name: '1st Edition' });

    return { id, category: 'pokemon', name: set.name, brand: 'Pokémon', season: (set.releaseDate ?? '').slice(0, 4), source: `https://www.tcgdex.net/database/${code}`, fetched: new Date().toISOString(), sections, parallels };
  },
};

const none: Provider = { list: async () => [], load: async () => null };

export const PROVIDERS: Record<Category, Provider> = { hockey, mtg, pokemon, baseball: none };

export function categoryOf(id: string): Category {
  if (id.startsWith('mtg-')) return 'mtg';
  if (id.startsWith('pkm-')) return 'pokemon';
  return 'hockey';
}
