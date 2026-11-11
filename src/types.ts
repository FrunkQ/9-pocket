// Shapes of the checklist data built by scripts/build-checklists.mjs,
// and of the user's own collection.

export interface Card {
  /** Card number as printed, e.g. "8" or "CF-12". */
  n: string;
  /** Player (or card subject). */
  p: string;
  /** Team abbreviation, e.g. "WSH". Empty when the source has none. */
  t: string;
  rc?: 1;
  au?: 1;
  mem?: 1;
  sp?: string;
  /** Print run when the card itself is serial numbered. */
  sn?: number;
  /** Exists only as parallels (no plain base version). */
  po?: 1;
  /** Stock picture of the card (small and large), where the source provides one. */
  img?: string;
  imgL?: string;
  /** A second line under the name, e.g. rarity and card type. */
  sub?: string;
  /** Market price in US dollars from the data source, when it gives one. */
  pr?: number;
  /** Market prices for other versions, by version id. */
  vp?: Record<string, number>;
}

export type Category = 'hockey' | 'mtg' | 'pokemon' | 'baseball';

export const CATEGORIES: { id: Category; label: string; ready: boolean }[] = [
  { id: 'hockey', label: 'Hockey', ready: true },
  { id: 'mtg', label: 'Magic', ready: true },
  { id: 'pokemon', label: 'Pokémon', ready: true },
  { id: 'baseball', label: 'Baseball', ready: false },
];

/** A set as it appears in a catalogue list, before its cards are downloaded. */
export interface SetInfo {
  id: string;
  category: Category;
  name: string;
  brand: string;
  /** Season or year, e.g. "2025-26" or "2024". Empty when the source has none. */
  season: string;
  count: number;
  icon?: string;
}

export interface Parallel {
  id: string;
  name: string;
  /** Print run, e.g. 199 for "/199". */
  sn?: number;
  odds?: string;
  au?: 1;
  mem?: 1;
  /** Limits the parallel to these base sections. */
  sections?: string[];
  /** Limits the parallel to these card numbers. */
  cards?: string[];
}

export interface Section {
  id: string;
  name: string;
  kind: 'base' | 'insert';
  cards: Card[];
  odds?: string;
  /** Insert sets carry their own parallels; base sections share the product's. */
  parallels?: Parallel[];
}

export interface Product {
  id: string;
  category: Category;
  name: string;
  brand: string;
  season: string;
  source: string;
  /** When this copy of the set was downloaded. */
  fetched?: string;
  sections: Section[];
  parallels: Parallel[];
}

export type Condition = 'M' | 'NM' | 'EX' | 'PL';
export type Protection = 'none' | 'sleeve' | 'toploader' | 'graded';

/** One physical card the user owns. */
export interface Copy {
  id: string;
  product: string;
  section: string;
  n: string;
  /** "base" or a parallel id. */
  version: string;
  condition: Condition;
  protection: Protection;
  /** ISO date-time the copy was added. */
  added: string;
}

export interface Settings {
  ebaySite: string;
  /** Name shown to a friend when the collection is shared. */
  name: string;
  /** The rear camera chosen for scanning; empty lets the app choose. */
  cameraId: string;
  /** The kind of card last browsed or scanned. */
  category: Category;
  /** Currency values are shown in, e.g. "GBP". Everything is stored in US dollars. */
  currency: string;
}

export interface CollectionState {
  version: 1;
  copies: Copy[];
  /** Sets the user has added, as binder ids, in the order added. */
  binders: string[];
  settings: Settings;
}

export const CONDITIONS: { id: Condition; label: string }[] = [
  { id: 'M', label: 'Mint' },
  { id: 'NM', label: 'Near mint' },
  { id: 'EX', label: 'Excellent' },
  { id: 'PL', label: 'Played' },
];

export const PROTECTIONS: { id: Protection; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'sleeve', label: 'Sleeved' },
  { id: 'toploader', label: 'Top loader' },
  { id: 'graded', label: 'Graded' },
];
