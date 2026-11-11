// The user's collection. Kept in this browser's localStorage (card photos
// are in IndexedDB, see photos.ts); the backup download on the home screen is
// the way to keep it safe or move it.
import { useSyncExternalStore } from 'react';
import type { CollectionState, Condition, Copy, Protection, Settings } from '../types';
import { cardKey } from '../data/catalog';
import { deletePhoto, deletePhotosWhere, exportPhotos, importPhotos, type ExportedPhoto } from './photos';

const STORAGE_KEY = 'ninepocket.v1';

const EMPTY: CollectionState = { version: 1, copies: [], settings: { ebaySite: 'www.ebay.com', name: '', cameraId: '' } };

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
  return { version: 1, copies, settings: { ...EMPTY.settings, ...(v.settings ?? {}) } };
}

function isCopy(c: unknown): c is Copy {
  const x = c as Copy;
  return !!x && typeof x.id === 'string' && typeof x.product === 'string' && typeof x.section === 'string' && typeof x.n === 'string';
}

let state: CollectionState = load();
let index: Map<string, Copy[]> | null = null;
const listeners = new Set<() => void>();

function commit(next: CollectionState) {
  state = next;
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
    condition: input.condition ?? 'NM',
    protection: input.protection ?? 'none',
    added: new Date().toISOString(),
  };
  commit({ ...state, copies: [...state.copies, copy] });
  return copy;
}

export function updateCopy(id: string, patch: Partial<Pick<Copy, 'version' | 'condition' | 'protection'>>) {
  commit({ ...state, copies: state.copies.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
}

export function removeCopy(id: string) {
  commit({ ...state, copies: state.copies.filter((c) => c.id !== id) });
  void deletePhoto(id);
}

export function updateSettings(patch: Partial<Settings>) {
  commit({ ...state, settings: { ...state.settings, ...patch } });
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
  return JSON.stringify({ app: 'nine-pocket', exported: new Date().toISOString(), ...state, ...(photos ? { photos } : {}) }, null, includePhotos ? 0 : 2);
}

export async function downloadBackup(includePhotos: boolean) {
  saveFile(`nine-pocket-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportBackup(includePhotos));
}

/**
 * Restores a backup file. "merge" keeps what is here and adds copies that
 * are not already present; "replace" swaps the whole collection.
 */
export async function importBackup(json: string, mode: 'merge' | 'replace'): Promise<{ added: number; total: number; photos: number }> {
  const parsed = JSON.parse(json) as { photos?: ExportedPhoto[] };
  const incoming = normalise(parsed);
  const incomingPhotos = Array.isArray(parsed.photos) ? parsed.photos.filter((p) => p && isOwnPhoto(String(p.key))) : [];
  let added: number;
  if (mode === 'replace') {
    await deletePhotosWhere(isOwnPhoto);
    commit({ ...incoming, settings: { ...incoming.settings, cameraId: state.settings.cameraId } });
    added = incoming.copies.length;
  } else {
    const have = new Set(state.copies.map((c) => c.id));
    const fresh = incoming.copies.filter((c) => !have.has(c.id));
    commit({ ...state, copies: [...state.copies, ...fresh] });
    added = fresh.length;
  }
  const ids = new Set(state.copies.map((c) => c.id));
  const photos = await importPhotos(incomingPhotos.filter((p) => ids.has(p.id)));
  return { added, total: state.copies.length, photos };
}
