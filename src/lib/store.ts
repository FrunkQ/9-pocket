// The user's collection. Kept in this browser's localStorage (card photos
// are in IndexedDB, see photos.ts); the backup download on the home screen is
// the way to keep it safe or move it.
import { useSyncExternalStore } from 'react';
import { CATEGORIES, type Category, type CollectionState, type Condition, type Copy, type Product, type Protection, type Settings } from '../types';
import { cardKey, categoryOf, ensureProducts, importedProducts, isOther, otherLabel, saveImported } from '../data/catalog';
import { setDisplayCurrency } from './currency';
import { setRules } from './estimate';
import { dbDelete } from './db';
import { deletePhoto, deletePhotosWhere, exportPhotos, importPhotos, type ExportedPhoto } from './photos';

const STORAGE_KEY = 'ninepocket.v1';

const EMPTY: CollectionState = { version: 1, copies: [], binders: [], settings: { ebaySite: 'www.ebay.com', name: '', cameraId: '', category: 'hockey', currency: 'USD' } };

/** Photos of the user's own cards (friends' shared pictures are keyed "friend:..."). */
export const isOwnPhoto = (key: string) => !key.startsWith('friend:');

function load(): CollectionState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    return normalise(JSON.parse(raw));
  } catch {
    return EMPTY;
  }
}

function normalise(value: unknown): CollectionState {
  const v = (value ?? {}) as Partial<CollectionState>;
  const copies = Array.isArray(v.copies) ? v.copies.filter(isCopy) : [];
  const binders = Array.isArray(v.binders) ? v.binders.filter((b): b is string => typeof b === 'string') : [];
  return { version: 1, copies, binders, settings: { ...EMPTY.settings, ...(v.settings ?? {}) } };
}

function isCopy(c: unknown): c is Copy {
  const x = c as Copy;
  return !!x && typeof x.id === 'string' && typeof x.product === 'string' && typeof x.section === 'string' && typeof x.n === 'string';
}

let state: CollectionState = load();
setDisplayCurrency(state.settings.currency);
setRules(state.settings.rules);
let index: Map<string, Copy[]> | null = null;
const listeners = new Set<() => void>();

function commit(next: CollectionState) {
  state = next;
  setDisplayCurrency(state.settings.currency);
  setRules(state.settings.rules);
  index = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: keep working in memory for this session.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCollection(): CollectionState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Copies grouped by card. */
export function copiesByCard(s: CollectionState): Map<string, Copy[]> {
  if (s !== state) return buildIndex(s);
  if (!index) index = buildIndex(s);
  return index;
}

function buildIndex(s: CollectionState): Map<string, Copy[]> {
  const map = new Map<string, Copy[]>();
  for (const c of s.copies) {
    const key = cardKey(c.product, c.section, c.n);
    const list = map.get(key);
    if (list) list.push(c);
    else map.set(key, [c]);
  }
  return map;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function addCopy(input: { product: string; section: string; n: string; version?: string; condition?: Condition; protection?: Protection }): Copy {
  const copy: Copy = {
    id: newId(),
    product: input.product,
    section: input.section,
    n: input.n,
    version: input.version ?? 'base',
    // Most people keep a whole collection the same way, so a new card starts
    // as the last one was left: near mint and sleeved until told otherwise.
    condition: input.condition ?? defaultCondition(state.settings),
    protection: input.protection ?? defaultProtection(state.settings),
    added: new Date().toISOString(),
  };
  const kind = categoryOf(copy.product);
  const uses = { ...state.settings.uses, [kind]: (state.settings.uses?.[kind] ?? 0) + 1 };
  commit({ ...state, copies: [...state.copies, copy], settings: { ...state.settings, uses, condition: copy.condition, protection: copy.protection } });
  return copy;
}

export function updateCopy(id: string, patch: Partial<Pick<Copy, 'version' | 'condition' | 'protection'>>) {
  // A condition or protection chosen here becomes the starting point for the next card added.
  const settings = { ...state.settings, ...(patch.condition ? { condition: patch.condition } : {}), ...(patch.protection ? { protection: patch.protection } : {}) };
  commit({ ...state, settings, copies: state.copies.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
}

/** Changes every card recorded in a set at once: all sleeved, all regraded. Returns how many changed. */
export function updateSetCopies(productId: string, patch: Partial<Pick<Copy, 'condition' | 'protection'>>): number {
  const count = state.copies.filter((c) => c.product === productId).length;
  if (count === 0) return 0;
  // How a whole set is now kept is the likeliest way the next card will be kept too.
  const settings = { ...state.settings, ...(patch.protection ? { protection: patch.protection } : {}) };
  commit({ ...state, settings, copies: state.copies.map((c) => (c.product === productId ? { ...c, ...patch } : c)) });
  return count;
}

export const defaultCondition = (settings: Settings): Condition => settings.condition ?? 'NM';
export const defaultProtection = (settings: Settings): Protection => settings.protection ?? 'sleeve';

export function removeCopy(id: string) {
  commit({ ...state, copies: state.copies.filter((c) => c.id !== id) });
  void deletePhoto(id);
}

/** Every set the user is collecting: the ones they added, plus any they hold cards from. */
export function binderIds(s: CollectionState): string[] {
  const ids = [...s.binders];
  for (const c of s.copies) if (!ids.includes(c.product)) ids.push(c.product);
  return ids;
}

/**
 * Version names the user has made up for a set ("Blue", "Silver foil"), so a
 * name typed once is offered again for the set's other cards.
 */
export function namedVersions(s: CollectionState, productId: string, exceptCopyId?: string): string[] {
  const names = new Set<string>();
  for (const c of s.copies) {
    if (c.product !== productId || c.id === exceptCopyId || !isOther(c.version)) continue;
    const label = otherLabel(c.version).trim();
    if (label) names.add(label);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function addBinder(id: string) {
  if (state.binders.includes(id)) return;
  commit({ ...state, binders: [...state.binders, id] });
}

/** Takes a set off the home screen, along with any cards recorded in it. */
export function removeBinder(id: string) {
  const gone = state.copies.filter((c) => c.product === id);
  commit({ ...state, binders: state.binders.filter((b) => b !== id), copies: state.copies.filter((c) => c.product !== id) });
  for (const c of gone) void deletePhoto(c.id);
}

/** Wipes everything this app has stored on the device, then restarts it. */
export async function eraseEverything() {
  for (const key of Object.keys(localStorage)) if (key.startsWith('ninepocket.')) localStorage.removeItem(key);
  await dbDelete();
  window.location.hash = '';
  window.location.reload();
}

export function updateSettings(patch: Partial<Settings>) {
  commit({ ...state, settings: { ...state.settings, ...patch } });
}

// ---- Which tabs show, and which one the app opens on -------------------------

/** A catalogue kind shows unless switched off; a files kind is hidden until switched on. */
export const isKindShown = (settings: Settings, id: Category) => settings.kinds?.[id] ?? CATEGORIES.find((c) => c.id === id)?.source === 'catalogue';

export function shownKinds(settings: Settings): Category[] {
  const shown = CATEGORIES.filter((c) => isKindShown(settings, c.id)).map((c) => c.id);
  return shown.length > 0 ? shown : ['hockey'];
}

/** Shows or hides a tab. The last tab showing cannot be hidden. */
export function showKind(id: Category, on: boolean) {
  const kinds = { ...state.settings.kinds, [id]: on };
  const left = CATEGORIES.filter((c) => kinds[c.id] ?? c.source === 'catalogue');
  if (left.length === 0) return;
  const category = left.some((c) => c.id === state.settings.category) ? state.settings.category : left[0].id;
  updateSettings({ kinds, category });
}

/** Counts a use of a kind of card: a set opened, a card added. */
export function noteUse(id: Category) {
  const uses = { ...state.settings.uses, [id]: (state.settings.uses?.[id] ?? 0) + 1 };
  commit({ ...state, settings: { ...state.settings, uses } });
}

/** Turns to the tab used most. Called once when the app opens. */
export function openOnFavourite() {
  const shown = shownKinds(state.settings);
  let best: Category | undefined;
  for (const id of shown) {
    const n = state.settings.uses?.[id] ?? 0;
    if (n > 0 && (!best || n > (state.settings.uses?.[best] ?? 0))) best = id;
  }
  const category = best ?? (shown.includes(state.settings.category) ? state.settings.category : shown[0]);
  if (category !== state.settings.category) updateSettings({ category });
}

// ---- Backup ---------------------------------------------------------

export function saveFile(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportBackup(includePhotos: boolean): Promise<string> {
  const photos = includePhotos ? await exportPhotos(isOwnPhoto) : undefined;
  // Sets loaded from checklist files exist nowhere else, so they go in the backup too.
  const sets = await importedProducts();
  return JSON.stringify({ app: 'nine-pocket', exported: new Date().toISOString(), ...state, ...(sets.length ? { sets } : {}), ...(photos ? { photos } : {}) }, null, includePhotos || sets.length ? 0 : 2);
}

export async function downloadBackup(includePhotos: boolean) {
  saveFile(`nine-pocket-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportBackup(includePhotos));
}

/**
 * Restores a backup file. "merge" keeps what is here and adds copies that
 * are not already present; "replace" swaps the whole collection.
 */
export async function importBackup(json: string, mode: 'merge' | 'replace'): Promise<{ added: number; total: number; photos: number }> {
  const parsed = JSON.parse(json) as { photos?: ExportedPhoto[]; sets?: Product[] };
  const incoming = normalise(parsed);
  for (const set of Array.isArray(parsed.sets) ? parsed.sets : []) {
    if (set && typeof set.id === 'string' && set.id.startsWith('imp-') && Array.isArray(set.sections) && Array.isArray(set.parallels)) await saveImported(set).catch(() => undefined);
  }
  const incomingPhotos = Array.isArray(parsed.photos) ? parsed.photos.filter((p) => p && isOwnPhoto(String(p.key))) : [];
  let added: number;
  if (mode === 'replace') {
    await deletePhotosWhere(isOwnPhoto);
    commit({ ...incoming, settings: { ...incoming.settings, cameraId: state.settings.cameraId } });
    added = incoming.copies.length;
  } else {
    const have = new Set(state.copies.map((c) => c.id));
    const fresh = incoming.copies.filter((c) => !have.has(c.id));
    commit({ ...state, copies: [...state.copies, ...fresh], binders: [...state.binders, ...incoming.binders.filter((b) => !state.binders.includes(b))] });
    added = fresh.length;
  }
  const ids = new Set(state.copies.map((c) => c.id));
  const photos = await importPhotos(incomingPhotos.filter((p) => ids.has(p.id)));
  await ensureProducts(binderIds(state));
  return { added, total: state.copies.length, photos };
}
