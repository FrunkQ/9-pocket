// The sets the app knows about. Sets are downloaded when first needed and
// kept on the device, so only the ones a person collects take up space.
// Everything else in the app reads loaded sets synchronously from here.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Card, Category, Parallel, Product, Section, SetInfo } from '../types';
import { dbRun } from '../lib/db';
import { categoryOf, IMPORTED, isLive, PROVIDERS } from './providers';

export { categoryOf, isLive };

const loaded = new Map<string, Product>();
const pending = new Map<string, Promise<Product | null>>();
let version = 0;
const listeners = new Set<() => void>();

function bump() {
  version++;
  listeners.forEach((l) => l());
}

/** Re-renders the caller when a set finishes loading. */
export function useCatalogVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

export function getProduct(id: string): Product | undefined {
  return loaded.get(id);
}

export function loadedProducts(): Product[] {
  return [...loaded.values()];
}

// Prices from a live source go stale; refresh those sets now and then.
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

async function download(id: string): Promise<Product | null> {
  if (id.startsWith(IMPORTED)) return null; // Loaded from a file: there is nowhere to download it from.
  const product = await PROVIDERS[categoryOf(id)].load(id).catch(() => null);
  if (!product) return null;
  // Older files may lack the category.
  const complete: Product = { ...product, category: product.category ?? categoryOf(id) };
  void dbRun('sets', 'readwrite', (s) => s.put(complete)).catch(() => undefined);
  return complete;
}

/** Makes a set available: from memory, then the device, then the network. */
export function ensureProduct(id: string): Promise<Product | null> {
  const have = loaded.get(id);
  if (have) return Promise.resolve(have);
  let job = pending.get(id);
  if (!job) {
    job = (async () => {
      const cached = await dbRun<Product | undefined>('sets', 'readonly', (s) => s.get(id)).catch(() => undefined);
      const product = cached ?? (await download(id));
      if (!product) return null;
      loaded.set(id, product);
      bump();
      const age = product.fetched ? Date.now() - Date.parse(product.fetched) : 0;
      if (cached && isLive(id) && age > STALE_MS) void refreshProduct(id);
      return product;
    })();
    pending.set(id, job);
    void job.finally(() => pending.delete(id));
  }
  return job;
}

/** Downloads a fresh copy of a set (new cards, current prices). */
export async function refreshProduct(id: string): Promise<boolean> {
  const fresh = await download(id);
  if (!fresh) return false;
  loaded.set(id, fresh);
  bump();
  return true;
}

export function ensureProducts(ids: Iterable<string>): Promise<unknown> {
  return Promise.allSettled([...new Set(ids)].map(ensureProduct));
}

export type ProductStatus = 'ready' | 'loading' | 'missing';

/** A set for a screen that needs it, loading it if necessary. */
export function useProduct(id: string): { product: Product | undefined; status: ProductStatus } {
  useCatalogVersion();
  const [failed, setFailed] = useState('');
  useEffect(() => {
    if (!id || getProduct(id)) return;
    let live = true;
    ensureProduct(id).then((p) => {
      if (live && !p) setFailed(id);
    });
    return () => {
      live = false;
    };
  }, [id]);
  const product = getProduct(id);
  return { product, status: product ? 'ready' : failed === id || !id ? 'missing' : 'loading' };
}

/** True once every listed set has been loaded (or has failed to). */
export function useProductsReady(ids: string[]): boolean {
  useCatalogVersion();
  const key = [...new Set(ids)].sort().join(',');
  const [done, setDone] = useState('');
  useEffect(() => {
    let live = true;
    void ensureProducts(key ? key.split(',') : []).then(() => {
      if (live) setDone(key);
    });
    return () => {
      live = false;
    };
  }, [key]);
  // Already-loaded sets never cause a wait (adding a binder that was just downloaded, say).
  return done === key || ids.every((id) => loaded.has(id));
}

// ---- Sets loaded from checklist files -------------------------------------

/** Every set the user has loaded from a file, straight from the device. */
export async function importedProducts(): Promise<Product[]> {
  const all = await dbRun<Product[]>('sets', 'readonly', (s) => s.getAll()).catch(() => [] as Product[]);
  return all.filter((p) => p && typeof p.id === 'string' && p.id.startsWith(IMPORTED));
}

/** Keeps a set built from a file (or restored from a backup) and makes it available at once. */
export async function saveImported(product: Product): Promise<void> {
  await dbRun('sets', 'readwrite', (s) => s.put(product));
  loaded.set(product.id, product);
  lists.delete(product.category);
  bump();
}

/** Forgets a loaded set altogether. */
export async function deleteImported(id: string): Promise<void> {
  if (!id.startsWith(IMPORTED)) return;
  await dbRun('sets', 'readwrite', (s) => s.delete(id)).catch(() => undefined);
  loaded.delete(id);
  lists.delete(categoryOf(id));
  bump();
}

const lists = new Map<Category, Promise<SetInfo[]>>();

/** Every set available for a kind of card: the catalogue's, then any loaded from files. */
export function listSets(category: Category): Promise<SetInfo[]> {
  let job = lists.get(category);
  if (!job) {
    job = Promise.all([PROVIDERS[category].list(), importedProducts()]).then(([catalogue, mine]) => [
      ...mine.filter((p) => p.category === category).map((p) => ({ id: p.id, category, name: p.name, brand: p.brand, season: p.season, count: baseCount(p) })),
      ...catalogue,
    ]);
    lists.set(category, job);
    job.then(
      (sets) => {
        if (sets.length === 0) lists.delete(category);
      },
      () => lists.delete(category),
    );
  }
  return job;
}

// ---- Reading a loaded set ----------------------------------------------

export function getSection(product: Product, sectionId: string): Section | undefined {
  return product.sections.find((s) => s.id === sectionId);
}

export function getCard(section: Section, n: string): Card | undefined {
  return section.cards.find((c) => c.n === n);
}

export function baseSections(product: Product): Section[] {
  return product.sections.filter((s) => s.kind === 'base');
}

export function insertSections(product: Product): Section[] {
  return product.sections.filter((s) => s.kind === 'insert');
}

export function baseCount(product: Product): number {
  return baseSections(product).reduce((n, s) => n + s.cards.length, 0);
}

export function cardKey(productId: string, sectionId: string, n: string): string {
  return `${productId}|${sectionId}|${n}`;
}

/** Parallels and variations that exist for this particular card. */
export function versionsFor(product: Product, section: Section, card: Card): Parallel[] {
  const pool = section.kind === 'base' ? product.parallels : section.parallels ?? [];
  return pool.filter((p) => {
    if (p.cards) return p.cards.includes(card.n);
    if (p.sections) return p.sections.includes(section.id);
    return true;
  });
}

/**
 * A version the checklist does not list is stored as "other:" followed by
 * whatever the collector calls it, e.g. "other:Blue".
 */
export const OTHER = 'other:';
export const isOther = (versionId: string) => versionId.startsWith(OTHER);
export const otherLabel = (versionId: string) => versionId.slice(OTHER.length);
/** Keeps a typed label safe to store and to pack into a share link. */
export const otherVersion = (label: string) => OTHER + label.replace(/[~,|]/g, ' ').replace(/\s+/g, ' ').slice(0, 40);

export function versionName(product: Product, section: Section, versionId: string): string {
  if (versionId === 'base') return 'Base';
  if (isOther(versionId)) return otherLabel(versionId).trim() || 'Other version';
  const pool = section.kind === 'base' ? product.parallels : section.parallels ?? [];
  const p = pool.find((x) => x.id === versionId);
  if (!p) return versionId;
  return p.sn ? `${p.name} /${p.sn}` : p.name;
}

/** Binder pages: nine pockets each. */
export function pagesOf<T>(items: T[], size = 9): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

/** "2025-26 Upper Deck Allure", "Magic Bloomburrow (2024)". */
export function productTitle(product: Product | SetInfo): string {
  return [product.season, product.brand, product.name].filter(Boolean).join(' ');
}
