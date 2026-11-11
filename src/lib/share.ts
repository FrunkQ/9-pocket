// Sharing a collection with a friend and comparing the two.
//
// There is no server: a collection travels either as a link (the whole list
// packed into the address) or as a file (which can also carry card photos).
// The person receiving it keeps it on their device as a friend's collection,
// separate from their own, and the app works out who could give what to whom.
import { useSyncExternalStore } from 'react';
import type { Card, Copy, Product, Section } from '../types';
import { cardKey, getCard, getProduct, getSection } from '../data/catalog';
import { deletePhotosWhere, exportPhotos, importPhotos, type ExportedPhoto } from './photos';
import { isOwnPhoto } from './store';

export interface SharedCopy {
  product: string;
  section: string;
  n: string;
  version: string;
}

export interface Friend {
  id: string;
  name: string;
  /** When this copy of their collection was received. */
  received: string;
  copies: SharedCopy[];
}

interface Shared {
  name: string;
  copies: SharedCopy[];
  photos?: ExportedPhoto[];
}

// ---- Friends kept on this device ------------------------------------

const FRIENDS_KEY = 'ninepocket.friends.v1';

function loadFriends(): Friend[] {
  try {
    const value = JSON.parse(localStorage.getItem(FRIENDS_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((f) => f && typeof f.id === 'string' && Array.isArray(f.copies)) : [];
  } catch {
    return [];
  }
}

let friends: Friend[] = loadFriends();
const listeners = new Set<() => void>();

function commit(next: Friend[]) {
  friends = next;
  try {
    localStorage.setItem(FRIENDS_KEY, JSON.stringify(friends));
  } catch {
    // Keep working in memory.
  }
  listeners.forEach((l) => l());
}

export function useFriends(): Friend[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => friends,
  );
}

export const friendPhotoKey = (friendId: string, key: string) => `friend:${friendId}|${key}`;

/** Saves a received collection. A later share from the same name replaces the earlier one. */
export async function saveFriend(shared: Shared): Promise<Friend> {
  const name = shared.name.trim() || 'A friend';
  const existing = friends.find((f) => f.name.toLowerCase() === name.toLowerCase());
  const friend: Friend = {
    id: existing?.id ?? `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    received: new Date().toISOString(),
    copies: shared.copies,
  };
  commit([...friends.filter((f) => f.id !== friend.id), friend]);
  await deletePhotosWhere((key) => key.startsWith(`friend:${friend.id}|`));
  if (shared.photos?.length) {
    await importPhotos(shared.photos, (p) => ({ id: `friend:${friend.id}:${p.id}`, key: friendPhotoKey(friend.id, p.key) }));
  }
  return friend;
}

export function removeFriend(id: string) {
  commit(friends.filter((f) => f.id !== id));
  void deletePhotosWhere((key) => key.startsWith(`friend:${id}|`));
}

// ---- Packing a collection for sending --------------------------------

function isSharedCopy(c: unknown): c is SharedCopy {
  const x = c as SharedCopy;
  return !!x && typeof x.product === 'string' && typeof x.section === 'string' && typeof x.n === 'string';
}

const slim = (copies: (Copy | SharedCopy)[]): SharedCopy[] => copies.map((c) => ({ product: c.product, section: c.section, n: c.n, version: c.version || 'base' }));

/** A share file: the card list, and the photos too if asked for. */
export async function buildShareFile(name: string, copies: Copy[], includePhotos: boolean): Promise<string> {
  const photos = includePhotos ? await exportPhotos(isOwnPhoto) : undefined;
  return JSON.stringify({ app: 'nine-pocket-share', shared: new Date().toISOString(), name, copies: slim(copies), ...(photos ? { photos } : {}) });
}

/** Reads a share file. A full backup file works too, so a friend can simply send their backup. */
export function parseShareFile(json: string): Shared {
  const v = JSON.parse(json) as { app?: string; name?: string; settings?: { name?: string }; copies?: unknown[]; photos?: ExportedPhoto[] };
  if (v.app !== 'nine-pocket-share' && v.app !== 'nine-pocket') throw new Error('Not a Nine Pocket file');
  const copies = Array.isArray(v.copies) ? slim(v.copies.filter(isSharedCopy)) : [];
  return { name: v.name ?? v.settings?.name ?? '', copies, photos: Array.isArray(v.photos) ? v.photos : undefined };
}

// Links carry the list in a compact form: for each set and section, the card
// numbers (with "~version" for parallels), compressed and made URL-safe.

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

async function pipe(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeShare(name: string, copies: Copy[]): Promise<string> {
  const groups: Record<string, string[]> = {};
  for (const c of copies) {
    const key = `${c.product}/${c.section}`;
    (groups[key] ??= []).push(c.version && c.version !== 'base' ? `${c.n}~${c.version}` : c.n);
  }
  const compact: Record<string, string> = {};
  for (const [key, list] of Object.entries(groups)) compact[key] = list.join(',');
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, n: name, c: compact }));
  if (typeof CompressionStream === 'undefined') return 'u' + toBase64Url(bytes);
  return 'z' + toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>));
}

export async function decodeShare(token: string): Promise<Shared> {
  const body = fromBase64Url(token.slice(1));
  const bytes = token[0] === 'z' ? await pipe(body, new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>) : body;
  const v = JSON.parse(new TextDecoder().decode(bytes)) as { n?: string; c?: Record<string, string> };
  const copies: SharedCopy[] = [];
  for (const [key, list] of Object.entries(v.c ?? {})) {
    const slash = key.indexOf('/');
    const product = key.slice(0, slash);
    const section = key.slice(slash + 1);
    for (const item of String(list).split(',')) {
      if (!item) continue;
      const [n, version = 'base'] = item.split('~');
      copies.push({ product, section, n, version });
    }
  }
  return { name: v.n ?? '', copies };
}

export function shareUrl(token: string): string {
  return `${window.location.origin}${window.location.pathname}#/friends/open?d=${token}`;
}

/** Pulls the share token out of a pasted link (or accepts a bare token). */
export function tokenFromLink(text: string): string | null {
  const m = text.trim().match(/[?&]d=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return /^[zu][A-Za-z0-9_-]{8,}$/.test(text.trim()) ? text.trim() : null;
}

// ---- Comparing ---------------------------------------------------------

export interface TradeCard {
  product: Product;
  section: Section;
  card: Card;
  /** How many the giver holds. Two or more means a spare. */
  held: number;
}

export interface Comparison {
  /** Cards the friend holds that you are missing, in sets you collect. */
  theyHave: TradeCard[];
  /** Cards you hold that the friend is missing, in sets they collect. */
  youHave: TradeCard[];
  /** Cards you both hold. */
  both: number;
}

function tally(copies: SharedCopy[]): { counts: Map<string, number>; products: Set<string> } {
  const counts = new Map<string, number>();
  const products = new Set<string>();
  for (const c of copies) {
    const key = cardKey(c.product, c.section, c.n);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    products.add(c.product);
  }
  return { counts, products };
}

function resolve(key: string): { product: Product; section: Section; card: Card } | null {
  const [productId, sectionId, n] = key.split('|');
  const product = getProduct(productId);
  const section = product && getSection(product, sectionId);
  const card = section && getCard(section, n);
  // Only the numbered base set counts as something to "need".
  if (!product || !section || !card || section.kind !== 'base') return null;
  return { product, section, card };
}

function gaps(giver: ReturnType<typeof tally>, taker: ReturnType<typeof tally>): TradeCard[] {
  const out: TradeCard[] = [];
  for (const [key, held] of giver.counts) {
    if (taker.counts.has(key)) continue;
    const found = resolve(key);
    // A set the other person has not started is not treated as a want list.
    if (!found || !taker.products.has(found.product.id)) continue;
    out.push({ ...found, held });
  }
  const order = (c: TradeCard) => (c.held > 1 ? 0 : 1);
  out.sort((a, b) => order(a) - order(b) || a.product.name.localeCompare(b.product.name) || (parseInt(a.card.n, 10) || 0) - (parseInt(b.card.n, 10) || 0));
  return out;
}

export function compare(mine: Copy[], theirs: SharedCopy[]): Comparison {
  const me = tally(mine);
  const them = tally(theirs);
  let both = 0;
  for (const key of me.counts.keys()) if (them.counts.has(key)) both++;
  return { theyHave: gaps(them, me), youHave: gaps(me, them), both };
}
