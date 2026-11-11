// The user's collection. Kept in this browser's localStorage; the backup
// download on the home screen is the way to keep it safe or move it.
import { useSyncExternalStore } from 'react';
import type { CollectionState, Condition, Copy, Protection, Settings } from '../types';
import { cardKey } from '../data/catalog';

const STORAGE_KEY = 'ninepocket.v1';

const EMPTY: CollectionState = { version: 1, copies: [], settings: { ebaySite: 'www.ebay.com' } };

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
}

export function updateSettings(patch: Partial<Settings>) {
  commit({ ...state, settings: { ...state.settings, ...patch } });
}

// ---- Backup ---------------------------------------------------------

export function exportBackup(): string {
  return JSON.stringify({ app: 'nine-pocket', exported: new Date().toISOString(), ...state }, null, 2);
}

export function downloadBackup() {
  const blob = new Blob([exportBackup()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nine-pocket-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Restores a backup file. "merge" keeps what is here and adds copies that
 * are not already present; "replace" swaps the whole collection.
 */
export function importBackup(json: string, mode: 'merge' | 'replace'): { added: number; total: number } {
  const incoming = normalise(JSON.parse(json));
  if (mode === 'replace') {
    commit(incoming);
    return { added: incoming.copies.length, total: incoming.copies.length };
  }
  const have = new Set(state.copies.map((c) => c.id));
  const fresh = incoming.copies.filter((c) => !have.has(c.id));
  commit({ ...state, copies: [...state.copies, ...fresh] });
  return { added: fresh.length, total: state.copies.length };
}
