// Draws the home-screen icon (an LA street-sign green tile with a house) as PNGs, no dependencies.
// Run: node scripts/icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const GREEN = [0x1d, 0x5c, 0x44], WHITE = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function icon(size) {
  const u = size / 180; // design units on a 180px grid
  const px = (x, y) => {
    // White inset border, like a street sign's rim.
    const inset = 16 * u, t = 6 * u, r = 18 * u;
    const inBox = (m) => {
      const x0 = m, y0 = m, x1 = size - m, y1 = size - m;
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
      return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    };
    if (inBox(inset) && !inBox(inset + t)) return WHITE;
    // House: roof triangle + body, with a green door.
    const cx = 90 * u, roofTop = 48 * u, roofBase = 92 * u, halfW = 50 * u;
    if (y >= roofTop && y <= roofBase && Math.abs(x - cx) <= ((y - roofTop) / (roofBase - roofTop)) * halfW) return WHITE;
    const bx0 = 58 * u, bx1 = 122 * u, by0 = 90 * u, by1 = 134 * u;
    if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) {
      if (x >= 80 * u && x <= 100 * u && y >= 106 * u) return GREEN;
      return WHITE;
    }
    return GREEN;
  };
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = px(x + 0.5, y + 0.5);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
  writeFileSync(new URL(`../public/${name}`, import.meta.url), icon(size));
  console.log("Wrote public/" + name);
}
