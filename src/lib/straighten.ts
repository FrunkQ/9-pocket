// Finds the four edges of a card in a photo and flattens it to a straight
// 5:7 picture. It expects the card to roughly fill the image (which is what
// the scan frame asks for), so each edge is searched for in the outer part of
// the image and allowed a modest tilt.
//
// When the edges cannot be found convincingly it falls back to the middle of
// the image, so the caller always gets a usable 5:7 picture.

export interface Straightened {
  canvas: HTMLCanvasElement;
  /** True when the card's edges were detected and the picture was flattened. */
  found: boolean;
}

type Point = [number, number];

const WORK_W = 240; // Edge search runs on a small greyscale copy.
const BAND = 0.34; // Each edge is looked for in this outer share of the image.
const TILT = 0.16; // Largest slope allowed, as a share of the edge's length.
const KEEP = 0.72; // Lines at least this strong compete for "outermost".
const FLANK = 2; // How far outside the true edge the chosen line tends to sit, in work pixels.
const EDGE_CAP = 28; // Brightness step (0-255) beyond which an edge is simply "clear".

function greyscale(source: HTMLCanvasElement, w: number, h: number): Float32Array {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  // A light blur so print texture and table grain do not read as edges.
  const blurred = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += out[yy * w + xx];
          n++;
        }
      }
      blurred[y * w + x] = sum / n;
    }
  }
  return blurred;
}

interface Line {
  /** Position at the start and end of the line (x for side edges, y for top/bottom). */
  a: number;
  b: number;
  score: number;
}

/**
 * Looks for the strongest near-vertical line (side edges) or near-horizontal
 * line (top and bottom) inside a band, preferring the outermost strong one so
 * a printed border inside the card does not win over the card's real edge.
 */
function findEdge(grad: Float32Array, w: number, h: number, vertical: boolean, from: number, to: number, outerIsLow: boolean): Line | null {
  const length = vertical ? h : w;
  const maxTilt = Math.round(length * TILT);
  const skip = Math.round(length * 0.1); // Ignore the rounded corners.
  const candidates: Line[] = [];
  let best = 0;
  for (let a = from; a <= to; a++) {
    for (let b = Math.max(from, a - maxTilt); b <= Math.min(to, a + maxTilt); b++) {
      let sum = 0;
      let n = 0;
      for (let t = skip; t < length - skip; t += 2) {
        const p = Math.round(a + ((b - a) * t) / (length - 1));
        const i = vertical ? t * w + p : p * w + t;
        sum += grad[i];
        n++;
      }
      const score = sum / n;
      candidates.push({ a, b, score });
      if (score > best) best = score;
    }
  }
  if (best === 0) return null;
  let pick: Line | null = null;
  for (const c of candidates) {
    if (c.score < best * KEEP) continue;
    const position = c.a + c.b;
    if (!pick || (outerIsLow ? position < pick.a + pick.b : position > pick.a + pick.b)) pick = c;
  }
  if (!pick) return null;
  // The outermost strong line sits on the outside flank of the (blurred)
  // edge; step back in so the result shows card, not a sliver of table.
  const inward = outerIsLow ? FLANK : -FLANK;
  return { a: pick.a + inward, b: pick.b + inward, score: pick.score };
}

function intersect(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
  if (Math.abs(d) < 1e-6) return null;
  const a = p1[0] * p2[1] - p1[1] * p2[0];
  const b = p3[0] * p4[1] - p3[1] * p4[0];
  return [(a * (p3[0] - p4[0]) - (p1[0] - p2[0]) * b) / d, (a * (p3[1] - p4[1]) - (p1[1] - p2[1]) * b) / d];
}

const dist = (p: Point, q: Point) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Corners of the card in the image as [top-left, top-right, bottom-right, bottom-left], or null. */
export function findCard(source: HTMLCanvasElement): Point[] | null {
  const w = WORK_W;
  const h = Math.round((source.height / source.width) * w);
  if (h < 60) return null;
  const grey = greyscale(source, w, h);

  const gx = new Float32Array(w * h); // Strength of vertical edges.
  const gy = new Float32Array(w * h); // Strength of horizontal edges.
  let total = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      // Capped, so a clear edge counts the same whether it is card against
      // table or a bold printed border: then the outermost one can win.
      gx[i] = Math.min(EDGE_CAP, Math.abs(grey[i + 1] - grey[i - 1]));
      gy[i] = Math.min(EDGE_CAP, Math.abs(grey[i + w] - grey[i - w]));
      total += gx[i] + gy[i];
    }
  }
  const mean = total / (2 * w * h);

  const left = findEdge(gx, w, h, true, 1, Math.round(w * BAND), true);
  const right = findEdge(gx, w, h, true, Math.round(w * (1 - BAND)), w - 2, false);
  const top = findEdge(gy, w, h, false, 1, Math.round(h * BAND), true);
  const bottom = findEdge(gy, w, h, false, Math.round(h * (1 - BAND)), h - 2, false);
  if (!left || !right || !top || !bottom) return null;

  // Every edge has to stand out clearly from the picture's general busyness.
  const floor = Math.max(6, mean * 1.8);
  if (left.score < floor || right.score < floor || top.score < floor || bottom.score < floor) return null;

  const L: [Point, Point] = [[left.a, 0], [left.b, h - 1]];
  const R: [Point, Point] = [[right.a, 0], [right.b, h - 1]];
  const T: [Point, Point] = [[0, top.a], [w - 1, top.b]];
  const B: [Point, Point] = [[0, bottom.a], [w - 1, bottom.b]];
  const tl = intersect(L[0], L[1], T[0], T[1]);
  const tr = intersect(R[0], R[1], T[0], T[1]);
  const br = intersect(R[0], R[1], B[0], B[1]);
  const bl = intersect(L[0], L[1], B[0], B[1]);
  if (!tl || !tr || !br || !bl) return null;

  // It has to look like a card: about 5:7 and a good share of the picture.
  const width = (dist(tl, tr) + dist(bl, br)) / 2;
  const height = (dist(tl, bl) + dist(tr, br)) / 2;
  const ratio = width / height;
  if (ratio < 0.62 || ratio > 0.82) return null;
  if ((width * height) / (w * h) < 0.3) return null;

  const scale = source.width / w;
  return [tl, tr, br, bl].map(([x, y]) => [x * scale, y * scale] as Point);
}

/** Solves for the 3x3 mapping that sends the output rectangle onto the card's corners. */
function homography(from: Point[], to: Point[]): number[] | null {
  const m: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    m.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    m.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-9) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 9; c++) m[r][c] -= f * m[col][c];
    }
  }
  return [...m.map((row, i) => row[8] / row[i]), 1];
}

function warp(source: HTMLCanvasElement, corners: Point[], outW: number, outH: number): HTMLCanvasElement | null {
  const H = homography(
    [
      [0, 0],
      [outW - 1, 0],
      [outW - 1, outH - 1],
      [0, outH - 1],
    ],
    corners,
  );
  if (!H) return null;
  const sw = source.width;
  const sh = source.height;
  const src = source.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d')!;
  const image = ctx.createImageData(outW, outH);
  const dst = image.data;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const d = H[6] * x + H[7] * y + H[8];
      const sx = Math.min(sw - 1.001, Math.max(0, (H[0] * x + H[1] * y + H[2]) / d));
      const sy = Math.min(sh - 1.001, Math.max(0, (H[3] * x + H[4] * y + H[5]) / d));
      const x0 = sx | 0;
      const y0 = sy | 0;
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (y * outW + x) * 4;
      for (let c = 0; c < 3; c++) {
        dst[o + c] = (src[i00 + c] * (1 - fx) + src[i10 + c] * fx) * (1 - fy) + (src[i01 + c] * (1 - fx) + src[i11 + c] * fx) * fy;
      }
      dst[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

/** The middle of the image at 5:7, less a margin: used when no edges are found. */
function centreCrop(source: HTMLCanvasElement, outW: number, outH: number, margin: number): HTMLCanvasElement {
  let w = source.width * (1 - margin * 2);
  let h = source.height * (1 - margin * 2);
  if (w / h > outW / outH) w = (h * outW) / outH;
  else h = (w * outH) / outW;
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, (source.width - w) / 2, (source.height - h) / 2, w, h, 0, 0, outW, outH);
  return out;
}

/**
 * Returns a straight 5:7 picture of the card in `source`.
 * `margin` is how much spare border the caller left around where the card
 * was expected, as a share of each side; it is trimmed in the fallback.
 */
export function straighten(source: HTMLCanvasElement, outW = 1000, margin = 0): Straightened {
  const outH = Math.round((outW * 7) / 5);
  const corners = findCard(source);
  if (corners) {
    const flat = warp(source, corners, outW, outH);
    if (flat) return { canvas: flat, found: true };
  }
  return { canvas: centreCrop(source, outW, outH, margin), found: false };
}
