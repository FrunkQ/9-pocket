// Reads the text off a photo of a card, entirely in the browser.
// The recogniser (Tesseract) is loaded the first time a card is scanned.
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

/** A greyscale negative, which helps with light lettering on dark card art. */
function inverted(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d')!;
  ctx.filter = 'grayscale(1) invert(1) contrast(1.4)';
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/**
 * Returns all text found on the image. Runs two passes (as photographed and
 * inverted) because card fronts mix dark-on-light and light-on-dark lettering.
 */
export async function readText(canvas: HTMLCanvasElement): Promise<string> {
  const worker = await getWorker();
  const first = await worker.recognize(canvas);
  const second = await worker.recognize(inverted(canvas));
  return `${first.data.text}\n${second.data.text}`;
}
