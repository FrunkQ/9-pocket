// Reads the text off a picture of a card, entirely in the browser.
// The recogniser (Tesseract) is loaded the first time a card is scanned.
//
// Card lettering is hard for a document reader: slanted display fonts,
// outlines, light text on photographs. So the card is read several times,
// each time prepared differently (whole card, high-contrast negative, the
// name bands enlarged, pure black-and-white), and the caller can stop as
// soon as one of the readings gives a confident match.
import type { Worker } from 'tesseract.js';

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) => createWorker('eng'));
    workerPromise.catch(() => {
      workerPromise = null; // Allow a retry after a failed download.
    });
  }
  return workerPromise;
}

/** Start loading the recogniser early so the first scan is not slow. */
export function warmUp() {
  void getWorker().catch(() => undefined);
}

const MAX_SIDE = 1400;

/** Copies an image or video frame to a canvas, scaled to a size OCR handles well. */
export function toCanvas(source: HTMLVideoElement | HTMLImageElement | ImageBitmap, maxSide = MAX_SIDE): HTMLCanvasElement {
  const w = 'videoWidth' in source ? source.videoWidth : source.width;
  const h = 'videoHeight' in source ? source.videoHeight : source.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A redrawn copy: a region of the source, optionally enlarged and filtered. */
function redraw(source: HTMLCanvasElement, region: { y: number; h: number }, scale: number, filter: string): HTMLCanvasElement {
  const sy = Math.round(source.height * region.y);
  const sh = Math.round(source.height * region.h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.filter = filter;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, sy, source.width, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Pure black and white, deciding each pixel against the brightness around it.
 * This pulls lettering off a photograph or a gradient where a single cut-off
 * for the whole card would lose it. `invert` makes light lettering black.
 */
function blackAndWhite(source: HTMLCanvasElement, invert: boolean): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  const grey = new Float32Array(w * h);
  for (let i = 0; i < grey.length; i++) grey[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  // Running sums give the average brightness of any box in constant time.
  const sums = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += grey[y * w + x];
      sums[(y + 1) * (w + 1) + x + 1] = sums[y * (w + 1) + x + 1] + row;
    }
  }
  const r = Math.max(8, Math.round(w / 28));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const area = (x1 - x0) * (y1 - y0);
      const mean = (sums[y1 * (w + 1) + x1] - sums[y0 * (w + 1) + x1] - sums[y1 * (w + 1) + x0] + sums[y0 * (w + 1) + x0]) / area;
      const dark = grey[y * w + x] < mean - 10;
      const ink = invert ? grey[y * w + x] > mean + 10 : dark;
      const v = ink ? 0 : 255;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

interface Pass {
  name: string;
  /** Page layout hint for the recogniser: 11 = scattered text, 6 = one block. */
  mode: '11' | '6';
  prepare(card: HTMLCanvasElement): HTMLCanvasElement;
}

const WHOLE = { y: 0, h: 1 };
const TOP = { y: 0, h: 0.32 };
const BOTTOM = { y: 0.62, h: 0.38 };

// Ordered by how often each one finds the name, cheapest first.
const PASSES: Pass[] = [
  { name: 'whole card', mode: '11', prepare: (c) => c },
  { name: 'negative', mode: '11', prepare: (c) => redraw(c, WHOLE, 1, 'grayscale(1) invert(1) contrast(1.5)') },
  { name: 'bottom band', mode: '11', prepare: (c) => redraw(c, BOTTOM, 1.8, 'grayscale(1) contrast(1.4)') },
  { name: 'top band', mode: '11', prepare: (c) => redraw(c, TOP, 1.8, 'grayscale(1) contrast(1.4)') },
  { name: 'black on white', mode: '11', prepare: (c) => blackAndWhite(c, false) },
  { name: 'white on black', mode: '11', prepare: (c) => blackAndWhite(c, true) },
  { name: 'bottom band negative', mode: '6', prepare: (c) => blackAndWhite(redraw(c, BOTTOM, 1.8, 'none'), true) },
  { name: 'top band negative', mode: '6', prepare: (c) => blackAndWhite(redraw(c, TOP, 1.8, 'none'), true) },
];

export const PASS_COUNT = PASSES.length;

/**
 * Reads the card pass by pass. After each pass `onText` gets everything read
 * so far; return true from it to stop early (a confident match was found).
 * Resolves with all the text read.
 */
export async function readCard(card: HTMLCanvasElement, onText: (text: string, pass: number) => boolean): Promise<string> {
  const worker = await getWorker();
  let text = '';
  for (let i = 0; i < PASSES.length; i++) {
    const pass = PASSES[i];
    await worker.setParameters({ tessedit_pageseg_mode: pass.mode as never });
    const result = await worker.recognize(pass.prepare(card));
    text += result.data.text + '\n';
    if (onText(text, i)) break;
  }
  return text;
}

/** Reads everything, without stopping early. */
export function readText(card: HTMLCanvasElement): Promise<string> {
  return readCard(card, () => false);
}
