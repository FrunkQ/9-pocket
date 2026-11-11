// Draws the app icon (a 3x3 binder page with some pockets filled) as PNG
// files in public/. Phones need PNG icons to install the app; this keeps them
// reproducible without an image library.
//
//   node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const PAGE = [0x15, 0x18, 0x1b];
const EMPTY = [0x3a, 0x40, 0x45];
const FILLED = [0xf1, 0xf3, 0xf2];
const RED = [0xd4, 0x28, 0x1c];

// Pocket layout on a 512 grid: [column, row, colour].
const X = [76, 204, 332];
const Y = [64, 198, 332];
const W = 104;
const H = 116;
const POCKETS = [
  [0, 0, EMPTY], [1, 0, FILLED], [2, 0, EMPTY],
  [0, 1, FILLED], [1, 1, EMPTY], [2, 1, FILLED],
  [0, 2, EMPTY], [1, 2, EMPTY], [2, 2, RED],
];

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * `scale` shrinks the grid towards the centre. Icons that the phone crops to
 * a circle ("maskable") need the artwork inside the middle 80%.
 */
function draw(size, scale) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const unit = size / 512;
  const radius = 8 * unit * scale;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // No filter.
    for (let x = 0; x < size; x++) {
      let colour = PAGE;
      // Back to 512-grid coordinates, undoing the scale about the centre.
      const gx = (x / unit - 256) / scale + 256;
      const gy = (y / unit - 256) / scale + 256;
      for (const [col, line, c] of POCKETS) {
        const px = gx - X[col];
        const py = gy - Y[line];
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        // Round the corners.
        const r = radius / unit / scale;
        const dx = Math.max(r - px, px - (W - r), 0);
        const dy = Math.max(r - py, py - (H - r), 0);
        if (dx * dx + dy * dy <= r * r) colour = c;
        break;
      }
      const i = row + 1 + x * 3;
      raw[i] = colour[0];
      raw[i + 1] = colour[1];
      raw[i + 2] = colour[2];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // Bit depth.
  header[9] = 2; // Truecolour.
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = [
  ['public/icon-192.png', 192, 1],
  ['public/icon-512.png', 512, 1],
  ['public/icon-maskable-512.png', 512, 0.7],
  ['public/apple-touch-icon.png', 180, 0.92],
];
for (const [path, size, scale] of files) {
  const png = draw(size, scale);
  writeFileSync(path, png);
  console.log(`${path}  ${size}x${size}  ${png.length} bytes`);
}
