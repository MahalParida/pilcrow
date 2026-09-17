// Generates the extension's PNG icons (a pilcrow mark) with no image
// dependencies. Chrome requires bitmaps for action/manifest icons, so the
// glyph is rasterised from primitives and supersampled for clean edges.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const SS = 4; // supersampling factor
const OUT = resolve(import.meta.dirname, '../public/icons');

const BG_TOP = [79, 70, 229];    // indigo-600
const BG_BOTTOM = [124, 58, 237]; // violet-600
const FG = [255, 255, 255];

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Signed coverage test helpers, all in 0..1 unit space. */
const inRoundedRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
    if (x >= x0 + r && x <= x1 - r) return true;
    if (y >= y0 + r && y <= y1 - r) return true;
  }
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inDisc = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** The pilcrow: a filled bowl joined to two descending stems. */
function isGlyph(x, y) {
  const bowlCx = 0.435, bowlCy = 0.355, bowlR = 0.175;
  const stemTop = bowlCy - bowlR, stemBottom = 0.84;
  const stemW = 0.075;
  const stemA = 0.615, stemB = 0.435;
  if (inRoundedRect(x, y, stemA - stemW / 2, stemTop, stemA + stemW / 2, stemBottom, stemW / 2)) return true;
  if (inRoundedRect(x, y, stemB - stemW / 2, stemTop, stemB + stemW / 2, stemBottom, stemW / 2)) return true;
  // Bowl: half-disc on the left, squared off where it meets the spine.
  if (x <= bowlCx && inDisc(x, y, bowlCx, bowlCy, bowlR)) return true;
  if (x > bowlCx && x <= stemA + stemW / 2 && y >= stemTop && y <= bowlCy + bowlR) return true;
  return false;
}

function render(size) {
  const n = size * SS;
  const acc = new Float64Array(size * size * 4);
  for (let sy = 0; sy < n; sy++) {
    for (let sx = 0; sx < n; sx++) {
      const x = (sx + 0.5) / n, y = (sy + 0.5) / n;
      let r = 0, g = 0, b = 0, a = 0;
      if (inRoundedRect(x, y, 0.03, 0.03, 0.97, 0.97, 0.22)) {
        const bg = mix(BG_TOP, BG_BOTTOM, y);
        [r, g, b] = isGlyph(x, y) ? FG : bg;
        a = 255;
      }
      const di = ((sy / SS) | 0) * size + ((sx / SS) | 0);
      acc[di * 4] += r; acc[di * 4 + 1] += g; acc[di * 4 + 2] += b; acc[di * 4 + 3] += a;
    }
  }
  const px = SS * SS;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4, d = y * (size * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 4; c++) raw[d + c] = Math.round(acc[s + c] / px);
    }
  }
  return raw;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(render(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = resolve(OUT, `icon-${size}.png`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png(size));
  console.log(`wrote ${file}`);
}
