// Finds the four edges of a card in a photo and flattens it to a straight
// 5:7 picture. Two ways of finding the card are tried:
//
//   By background  The colours around the rim of the photo are taken to be
//                  the table, mat or carpet; whatever in the middle is not
//                  those colours is the card. This copes with a card that is
//                  small in the picture, off-centre or well tilted, and with
//                  textured backgrounds, but needs background on every side.
//   By edges       Each edge is searched for as a line in the outer part of
//                  the image. This is for a card that fills the frame, where
//                  there is too little background to learn from.
//
// When neither is convincing it falls back to the middle of the image, so the
// caller always gets a usable 5:7 picture.

export interface Straightened {
  canvas: HTMLCanvasElement;
  /** True when the card's edges were detected and the picture was flattened. */
  found: boolean;
  /** True when the card reaches the edge of the picture, which is why it could not be found. */
  tooClose: boolean;
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

// ---- Finding the card by its background -------------------------------------

const MASK_W = 300; // Size of the copy the background search runs on.
const RIM = 0.025; // Share of the picture's shorter side taken as "certainly background".
const Y_BINS = 16; // Brightness is sorted into this many levels,
const C_BINS = 32; // and each of the two colour axes into this many.

interface Fit {
  a: number;
  b: number;
  /** Share of the points that lie on the line. */
  kept: number;
}

/**
 * Fits x = a + b*t along one side of the card. The points are the outermost
 * "not background" pixel in each row (or column), so they are a mix of the
 * true edge, dents where the card's own border is the colour of the
 * background, and the odd stray mark outside it. The side is the line with
 * the most points on it that has almost nothing beyond it: `outward` is +1
 * when larger x is away from the card, -1 when smaller x is.
 */
function fitSide(ts: number[], xs: number[], outward: number): Fit | null {
  const n = ts.length;
  if (n < 10) return null;
  const pickFrom = (lo: number, hi: number) => {
    const out: number[] = [];
    const step = Math.max(1, Math.floor((hi - lo) / 14));
    for (let i = lo; i < hi; i += step) out.push(i);
    return out;
  };
  let bestA = 0;
  let bestB = 0;
  let bestOn = 0;
  for (const i of pickFrom(0, Math.floor(n * 0.4))) {
    for (const j of pickFrom(Math.ceil(n * 0.6), n)) {
      const b = (xs[j] - xs[i]) / (ts[j] - ts[i]);
      const a = xs[i] - b * ts[i];
      let on = 0;
      let beyond = 0;
      for (let k = 0; k < n; k++) {
        const r = (xs[k] - (a + b * ts[k])) * outward;
        if (r > 1.25) beyond++;
        else if (r >= -1.25) on++;
      }
      if (beyond <= n * 0.1 && on > bestOn) {
        bestOn = on;
        bestA = a;
        bestB = b;
      }
    }
  }
  if (bestOn < n * 0.3) return null;
  // Settle the line through the points it runs along.
  let st = 0;
  let sx = 0;
  let stt = 0;
  let stx = 0;
  let m = 0;
  for (let k = 0; k < n; k++) {
    if (Math.abs(xs[k] - (bestA + bestB * ts[k])) > 1.5) continue;
    st += ts[k];
    sx += xs[k];
    stt += ts[k] * ts[k];
    stx += ts[k] * xs[k];
    m++;
  }
  const d = m * stt - st * st;
  if (m < 6 || Math.abs(d) < 1e-9) return { a: bestA, b: bestB, kept: bestOn / n };
  const b = (m * stx - st * sx) / d;
  return { a: (sx - b * st) / m, b, kept: bestOn / n };
}

/** Convex outline of a set of points, anticlockwise. */
function hull(points: Point[]): Point[] {
  const p = [...points].sort((m, n) => m[0] - n[0] || m[1] - n[1]);
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

const quadArea = (q: Point[]) => Math.abs(q.reduce((sum, p, i) => sum + p[0] * q[(i + 1) % q.length][1] - q[(i + 1) % q.length][0] * p[1], 0)) / 2;

/**
 * The card as the one large thing in the picture that is not the colour of
 * the background around the rim. Returns corners in source pixels, or null
 * when the picture does not suit this (no clear background, card cut off).
 */
export function findByBackground(source: HTMLCanvasElement, note: (why: string) => void = () => undefined): Point[] | null {
  const w = MASK_W;
  const h = Math.round((source.height / source.width) * w);
  if (h < 80) return null;
  const no = (why: string) => {
    note('background: ' + why);
    return null;
  };
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  // Each pixel's colour, sorted into a coarse box: brightness and two colour axes.
  const box = new Uint16Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 + 0.564 * (b - y);
    const cr = 128 + 0.713 * (r - y);
    box[i] = (Math.min(Y_BINS - 1, (y * Y_BINS) >> 8) * C_BINS + Math.min(C_BINS - 1, (cb * C_BINS) >> 8)) * C_BINS + Math.min(C_BINS - 1, (cr * C_BINS) >> 8);
  }

  // Learn the background from the rim, one side at a time. A colour counts
  // only if at least three sides show it: a card poking into one side of the
  // picture must not teach its own colours as background.
  const rim = Math.max(3, Math.round(Math.min(w, h) * RIM));
  const boxes = Y_BINS * C_BINS * C_BINS;
  const sides = new Uint8Array(boxes);
  const strips: [number, number, number, number][] = [
    [0, 0, w, rim],
    [0, h - rim, w, h],
    [0, rim, rim, h - rim],
    [w - rim, rim, w, h - rim],
  ];
  // Only the outermost few pixels are learned from; the rest of the rim is
  // then checked against what was learned (below), so a card whose border
  // reaches into the rim is noticed rather than learned.
  const outer = Math.max(2, Math.round(rim * 0.4));
  const learnFrom: [number, number, number, number][] = [
    [0, 0, w, outer],
    [0, h - outer, w, h],
    [0, outer, outer, h - outer],
    [w - outer, outer, w, h - outer],
  ];
  for (const [x0, y0, x1, y1] of learnFrom) {
    const seen = new Uint32Array(boxes);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) seen[box[y * w + x]]++;
    const enough = Math.max(2, (x1 - x0) * (y1 - y0) * 0.004);
    for (let k = 0; k < boxes; k++) if (seen[k] >= enough) sides[k]++;
  }
  // Nearby shades count too: a shadow is the same colour, a little darker.
  const background = new Uint8Array(boxes);
  let learned = 0;
  for (let k = 0; k < boxes; k++) {
    if (sides[k] < 3) continue;
    learned++;
    const yb = Math.floor(k / (C_BINS * C_BINS));
    const cbb = Math.floor(k / C_BINS) % C_BINS;
    const crb = k % C_BINS;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = yb + dy;
      if (yy < 0 || yy >= Y_BINS) continue;
      for (let da = -1; da <= 1; da++) {
        const aa = cbb + da;
        if (aa < 0 || aa >= C_BINS) continue;
        for (let db = -1; db <= 1; db++) {
          const bb = crb + db;
          if (bb < 0 || bb >= C_BINS) continue;
          background[(yy * C_BINS + aa) * C_BINS + bb] = 1;
        }
      }
    }
  }
  if (learned === 0) return no('no colour is shared by three sides of the rim');

  // The rim has to show one background, not two. A bordered card that all but
  // fills the picture puts both the table and its own border in the rim, and
  // both would be learned; the "card" found would then be the picture printed
  // inside the border. Carpet and wood are many shades but one run of them;
  // table and border are two separate groups of colour.
  {
    const rimCount = new Uint32Array(boxes);
    let rimTotal = 0;
    for (const [x0, y0, x1, y1] of strips) {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          rimCount[box[y * w + x]]++;
          rimTotal++;
        }
      }
    }
    const group = new Uint8Array(boxes);
    const queue = new Int32Array(boxes);
    const masses: number[] = [];
    const plane = C_BINS * C_BINS;
    for (let start = 0; start < boxes; start++) {
      if (!background[start] || group[start]) continue;
      let head = 0;
      let tail = 0;
      let mass = 0;
      queue[tail++] = start;
      group[start] = 1;
      while (head < tail) {
        const k = queue[head++];
        mass += rimCount[k];
        const cbb = Math.floor(k / C_BINS) % C_BINS;
        const crb = k % C_BINS;
        const near = [k - plane, k + plane, cbb > 0 ? k - C_BINS : -1, cbb < C_BINS - 1 ? k + C_BINS : -1, crb > 0 ? k - 1 : -1, crb < C_BINS - 1 ? k + 1 : -1];
        for (const j of near) {
          if (j < 0 || j >= boxes || !background[j] || group[j]) continue;
          group[j] = 1;
          queue[tail++] = j;
        }
      }
      masses.push(mass);
    }
    masses.sort((p, q) => q - p);
    if ((masses[1] ?? 0) > rimTotal * 0.12) return no('the rim shows two backgrounds (' + masses.slice(0, 3).map((m) => Math.round((m / rimTotal) * 100)).join('/') + '%)');
  }

  // The rim has to be background nearly all the way round. When a card fills
  // the picture its own border is what the rim shows, and the "card" found
  // would be the picture printed inside the border.
  for (const [x0, y0, x1, y1] of strips) {
    let count = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) count += background[box[y * w + x]];
    if (count < (x1 - x0) * (y1 - y0) * 0.8) return no('the rim is not all background (' + Math.round((count / ((x1 - x0) * (y1 - y0))) * 100) + '%)');
  }

  // Everything else is "something", tidied so specks of grain drop out.
  let mask: Uint8Array = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = background[box[i]] ? 0 : 1;
  const morph = (input: Uint8Array, grow: boolean): Uint8Array => {
    const out = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) count += input[(y + dy) * w + x + dx];
        out[y * w + x] = grow ? (count > 0 ? 1 : 0) : count === 9 ? 1 : 0;
      }
    }
    return out;
  };
  mask = morph(morph(mask, false), true);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < rim || y < rim || x >= w - rim || y >= h - rim) mask[y * w + x] = 0;
    }
  }

  // Parts of a card can be the colour of the background (a grey border on a
  // grey carpet), so the card may show as several pieces. Keep every piece of
  // any size; together they mark out the card.
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const sizes: number[] = [0];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start]) continue;
    const id = sizes.length;
    let top = 0;
    let size = 0;
    stack[top++] = start;
    label[start] = id;
    while (top > 0) {
      const i = stack[--top];
      size++;
      const x = i % w;
      if (x > 0 && mask[i - 1] && !label[i - 1]) (label[i - 1] = id), (stack[top++] = i - 1);
      if (x < w - 1 && mask[i + 1] && !label[i + 1]) (label[i + 1] = id), (stack[top++] = i + 1);
      if (i >= w && mask[i - w] && !label[i - w]) (label[i - w] = id), (stack[top++] = i - w);
      if (i < w * (h - 1) && mask[i + w] && !label[i + w]) (label[i + w] = id), (stack[top++] = i + w);
    }
    sizes.push(size);
  }
  const smallest = Math.max(12, w * h * 0.0008);
  const solid = (i: number) => sizes[label[i]] >= smallest;
  const outline: Point[] = [];
  const inside: Point[] = [];
  let total = 0;
  let atRim = 0;
  for (let y = rim; y < h - rim; y++) {
    for (let x = rim; x < w - rim; x++) {
      const i = y * w + x;
      if (!solid(i)) continue;
      total++;
      if ((x + y) % 3 === 0) inside.push([x, y]);
      if (!solid(i - 1) || !solid(i + 1) || !solid(i - w) || !solid(i + w)) {
        outline.push([x, y]);
        if (x === rim || y === rim || x === w - rim - 1 || y === h - rim - 1) atRim++;
      }
    }
  }
  if (total < w * h * 0.025) return no('nothing large stands out from the background');
  if (atRim > Math.sqrt(total) * 0.5) return no('the card runs off the picture');
  const around = hull(outline);
  if (around.length < 4) return no('no outline');

  // A first guess at which way the card is turned: the tilt of the tightest box around it.
  let angle = 0;
  let tightest = Infinity;
  for (let i = 0; i < around.length; i++) {
    const p = around[i];
    const q = around[(i + 1) % around.length];
    const t = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const c = Math.cos(t);
    const sn = Math.sin(t);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const [x, y] of around) {
      const u = x * c + y * sn;
      const v = -x * sn + y * c;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < tightest) {
      tightest = area;
      angle = t;
    }
  }
  // Cards are held roughly upright: take the quarter turn nearest to that.
  while (angle > Math.PI / 4) angle -= Math.PI / 2;
  while (angle <= -Math.PI / 4) angle += Math.PI / 2;

  // Turn the outline upright, find each side as a line along the outermost
  // points (leaving the corners out, which may be rounded), then correct the
  // turn by however much the four sides still lean, and go again.
  let left: Fit | null = null;
  let right: Fit | null = null;
  let top: Fit | null = null;
  let bottom: Fit | null = null;
  for (let round = 0; round < 4; round++) {
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    const us: number[] = [];
    const vs: number[] = [];
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const [x, y] of outline) {
      const u = x * c + y * sn;
      const v = -x * sn + y * c;
      us.push(u);
      vs.push(v);
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const cols = Math.ceil(u1 - u0) + 1;
    const rows = Math.ceil(v1 - v0) + 1;
    const leftMost = new Float32Array(rows).fill(Infinity);
    const rightMost = new Float32Array(rows).fill(-Infinity);
    const topMost = new Float32Array(cols).fill(Infinity);
    const bottomMost = new Float32Array(cols).fill(-Infinity);
    for (let i = 0; i < us.length; i++) {
      const row = Math.round(vs[i] - v0);
      const col = Math.round(us[i] - u0);
      if (us[i] < leftMost[row]) leftMost[row] = us[i];
      if (us[i] > rightMost[row]) rightMost[row] = us[i];
      if (vs[i] < topMost[col]) topMost[col] = vs[i];
      if (vs[i] > bottomMost[col]) bottomMost[col] = vs[i];
    }
    const side = (values: Float32Array, origin: number, outward: number) => {
      const ts: number[] = [];
      const xs: number[] = [];
      const skip = Math.round(values.length * 0.12);
      for (let k = skip; k < values.length - skip; k++) {
        if (!Number.isFinite(values[k])) continue;
        ts.push(k + origin);
        xs.push(values[k]);
      }
      return fitSide(ts, xs, outward);
    };
    left = side(leftMost, v0, -1); // u = a + b*v
    right = side(rightMost, v0, 1);
    top = side(topMost, u0, -1); // v = a + b*u
    bottom = side(bottomMost, u0, 1);
    if (!left || !right || !top || !bottom) return no('a side could not be found');
    const lean = (Math.atan(top.b) + Math.atan(bottom.b) - Math.atan(left.b) - Math.atan(right.b)) / 4;
    if (round === 3 || Math.abs(lean) < 0.004) break;
    angle += lean;
  }
  if (!left || !right || !top || !bottom) return no('a side could not be found');
  if (Math.min(left.kept, right.kept, top.kept, bottom.kept) < 0.3) return no('a side is too ragged');
  // Opposite sides of a card run nearly alongside each other, even seen at a slant.
  if (Math.abs(left.b - right.b) > 0.22 || Math.abs(top.b - bottom.b) > 0.22) return no('the sides do not run alongside each other');

  // Where a side line (u = a + b*v) meets a top or bottom line (v = c + d*u).
  const meet = (sideLine: Fit, flat: Fit): Point => {
    const v = (flat.a + flat.b * sideLine.a) / (1 - flat.b * sideLine.b);
    return [sideLine.a + sideLine.b * v, v];
  };
  const upright = [meet(left, top), meet(right, top), meet(right, bottom), meet(left, bottom)];
  const width = (dist(upright[0], upright[1]) + dist(upright[3], upright[2])) / 2;
  const height = (dist(upright[0], upright[3]) + dist(upright[1], upright[2])) / 2;
  const ratio = width / height;
  if (ratio < 0.6 || ratio > 0.86) return no('wrong shape for a card: ' + ratio.toFixed(2));
  const area = quadArea(upright);
  if (area < w * h * 0.04) return no('too small');

  // Nearly everything that stood out has to be inside the shape found, and fill a fair part of it.
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  let within = 0;
  for (const [x, y] of inside) {
    const u = x * c + y * sn;
    const v = -x * sn + y * c;
    if (u >= left.a + left.b * v - 2 && u <= right.a + right.b * v + 2 && v >= top.a + top.b * u - 2 && v <= bottom.a + bottom.b * u + 2) within++;
  }
  if (within < inside.length * 0.85) return no('too much lies outside the shape found');
  if (within * 3 < area * 0.3) return no('mostly background colour inside');

  // Back to the picture's own directions and size. The outline runs through
  // the middle of the outermost card pixels, so the true edge is a touch further out.
  const scale = source.width / w;
  const centre: Point = [(upright[0][0] + upright[2][0]) / 2, (upright[0][1] + upright[2][1]) / 2];
  return upright.map(([u, v]) => {
    const du = u - centre[0];
    const dv = v - centre[1];
    const grow = 1 + 0.25 / Math.max(1, Math.hypot(du, dv));
    const uu = centre[0] + du * grow;
    const vv = centre[1] + dv * grow;
    return [(uu * c - vv * sn + 0.5) * scale, (uu * sn + vv * c + 0.5) * scale] as Point;
  });
}

/** Corners of the card in the image as [top-left, top-right, bottom-right, bottom-left], or null. */
export function findCard(source: HTMLCanvasElement, note: (why: string) => void = () => undefined): Point[] | null {
  const byBackground = findByBackground(source, note);
  const byEdges = findByEdges(source);
  note(byBackground ? 'background: found' : '');
  note(byEdges ? 'edges: found' : 'edges: not found');
  if (!byBackground) {
    // With no background to go by, the edge search is only trusted for a
    // card that fills the picture: all four edges close to the picture's
    // own. Further in, the "edges" are lines printed on a card that is
    // partly out of view.
    if (!byEdges) return null;
    const near = 0.06;
    const [tl, tr, br, bl] = byEdges;
    const fills =
      Math.max(tl[0], bl[0]) < source.width * near &&
      Math.min(tr[0], br[0]) > source.width * (1 - near) &&
      Math.max(tl[1], tr[1]) < source.height * near &&
      Math.min(bl[1], br[1]) > source.height * (1 - near);
    note(fills ? '' : 'edges: not at the rim, so not trusted');
    return fills ? byEdges : null;
  }
  if (!byEdges) return byBackground;
  // Both found something. A card whose border is the colour of the table
  // loses its border to the background search; the edge search then finds a
  // slightly larger card around the same middle, and is the one to trust.
  const grown = quadArea(byEdges) / quadArea(byBackground);
  const middle = (q: Point[]): Point => [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];
  const apart = dist(middle(byEdges), middle(byBackground)) / dist(byBackground[0], byBackground[2]);
  return grown > 1.1 && grown < 1.45 && apart < 0.04 ? byEdges : byBackground;
}

// ---- Finding the card by its edges ------------------------------------------

export function findByEdges(source: HTMLCanvasElement): Point[] | null {
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
  if (ratio < 0.6 || ratio > 0.85) return null;
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
  let tooClose = false;
  const corners = findCard(source, (why) => {
    if (why.includes('runs off the picture') || why.includes('rim is not all background') || why.includes('two backgrounds')) tooClose = true;
  });
  if (corners) {
    const flat = warp(source, corners, outW, outH);
    if (flat) return { canvas: flat, found: true, tooClose: false };
  }
  return { canvas: centreCrop(source, outW, outH, margin), found: false, tooClose };
}
