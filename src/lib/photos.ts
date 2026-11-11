// Card photos. Each scanned copy can keep a straightened, compressed picture
// of the card. Pictures are too big for localStorage, so they live in the
// browser's IndexedDB, with a small in-memory index for fast display.
import { useSyncExternalStore } from 'react';

const DB_NAME = 'ninepocket';
const STORE = 'photos';
const FULL = { width: 500, height: 700, quality: 0.74 };
const THUMB = { width: 200, height: 280, quality: 0.7 };

interface PhotoRecord {
  /** The copy this picture belongs to (or "friend:<id>:<n>" for a shared one). */
  id: string;
  /** The card it shows, as a card key. Friends' pictures are prefixed "friend:<id>|". */
  key: string;
  full: Blob;
  thumb: Blob;
  added: string;
}

interface Entry {
  key: string;
  full: Blob;
  thumbUrl: string;
  fullUrl?: string;
  added: string;
}

export interface ExportedPhoto {
  id: string;
  key: string;
  /** JPEG as a data URL. */
  data: string;
}

const entries = new Map<string, Entry>(); // by record id
const idsByKey = new Map<string, string[]>();
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  version++;
  listeners.forEach((l) => l());
}

/** Re-renders the caller whenever a photo is added or removed. */
export function usePhotoVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

function index(record: PhotoRecord) {
  unindex(record.id);
  entries.set(record.id, { key: record.key, full: record.full, thumbUrl: URL.createObjectURL(record.thumb), added: record.added });
  const ids = idsByKey.get(record.key) ?? [];
  ids.push(record.id);
  idsByKey.set(record.key, ids);
}

function unindex(id: string) {
  const entry = entries.get(id);
  if (!entry) return;
  URL.revokeObjectURL(entry.thumbUrl);
  if (entry.fullUrl) URL.revokeObjectURL(entry.fullUrl);
  entries.delete(id);
  const ids = (idsByKey.get(entry.key) ?? []).filter((x) => x !== id);
  if (ids.length) idsByKey.set(entry.key, ids);
  else idsByKey.delete(entry.key);
}

/** Loads the saved pictures. Call once when the app starts. */
export async function loadPhotos(): Promise<void> {
  try {
    const records = await run<PhotoRecord[]>('readonly', (s) => s.getAll());
    for (const record of records) index(record);
    if (records.length) changed();
  } catch {
    // No IndexedDB (some private windows): the app works without pictures.
  }
}

/** The newest picture of a card, if there is one. */
export function photoFor(key: string): { thumb: string; full: string } | undefined {
  const ids = idsByKey.get(key);
  if (!ids || ids.length === 0) return undefined;
  const entry = entries.get(ids[ids.length - 1]);
  if (!entry) return undefined;
  if (!entry.fullUrl) entry.fullUrl = URL.createObjectURL(entry.full);
  return { thumb: entry.thumbUrl, full: entry.fullUrl };
}

export function photoCount(filter: (key: string) => boolean = () => true): number {
  let n = 0;
  for (const entry of entries.values()) if (filter(entry.key)) n++;
  return n;
}

function scaled(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))), 'image/jpeg', quality);
  });
}

async function store(id: string, key: string, source: CanvasImageSource): Promise<void> {
  const record: PhotoRecord = {
    id,
    key,
    full: await toBlob(scaled(source, FULL.width, FULL.height), FULL.quality),
    thumb: await toBlob(scaled(source, THUMB.width, THUMB.height), THUMB.quality),
    added: new Date().toISOString(),
  };
  await run('readwrite', (s) => s.put(record));
  index(record);
}

/** Saves a straightened 5:7 picture of a card against one copy. */
export async function savePhoto(id: string, key: string, card: HTMLCanvasElement): Promise<void> {
  try {
    await store(id, key, card);
    changed();
    // Ask the browser not to clear this site's storage when space runs low.
    void navigator.storage?.persist?.();
  } catch {
    // Storage full or unavailable: the copy is still recorded, just without a picture.
  }
}

export async function deletePhoto(id: string): Promise<void> {
  if (!entries.has(id)) return;
  unindex(id);
  changed();
  try {
    await run('readwrite', (s) => s.delete(id));
  } catch {
    // Nothing more to do.
  }
}

export async function deletePhotosWhere(match: (key: string) => boolean): Promise<void> {
  const ids = [...entries].filter(([, e]) => match(e.key)).map(([id]) => id);
  for (const id of ids) await deletePhoto(id);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Pictures as data URLs, for a backup or a share file. */
export async function exportPhotos(match: (key: string) => boolean): Promise<ExportedPhoto[]> {
  const out: ExportedPhoto[] = [];
  for (const [id, entry] of entries) {
    if (!match(entry.key)) continue;
    out.push({ id, key: entry.key, data: await blobToDataUrl(entry.full) });
  }
  return out;
}

/** Restores pictures from a backup or share file. `rename` can re-key them (used for friends). */
export async function importPhotos(list: ExportedPhoto[], rename?: (photo: ExportedPhoto) => { id: string; key: string }): Promise<number> {
  let saved = 0;
  for (const photo of list) {
    if (typeof photo?.data !== 'string' || !photo.data.startsWith('data:image/')) continue;
    try {
      const blob = await (await fetch(photo.data)).blob();
      const bitmap = await createImageBitmap(blob);
      const target = rename ? rename(photo) : { id: photo.id, key: photo.key };
      await store(target.id, target.key, bitmap);
      bitmap.close();
      saved++;
    } catch {
      // Skip a picture that will not decode.
    }
  }
  if (saved) changed();
  return saved;
}
