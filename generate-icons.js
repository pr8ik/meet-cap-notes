#!/usr/bin/env node
/**
 * MeetScribe icon generator — pure Node.js (no external deps)
 * Produces icon-16.png, icon-48.png, icon-128.png
 * Design: amber rounded square (#e39b55) with bold "M" in near-black (#1a1208)
 */

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// ─── Colours ─────────────────────────────────────────────────────────────────
const AMBER = [227, 155, 85, 255];
const DARK  = [26,  18,  8,  255];

// ─── PNG encoder (pure Node.js) ──────────────────────────────────────────────
function encodePNG(pixels, w, h) {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function writeChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf  = Buffer.allocUnsafe(4);
    const crcBuf  = Buffer.allocUnsafe(4);
    lenBuf.writeUInt32BE(data.length, 0);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  // IHDR: width, height, bit-depth=8, colour-type=6 (RGBA), comp=0, filter=0, interlace=0
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw scanlines: [filter-byte=0] + RGBA * w, per row
  const raw = Buffer.allocUnsafe(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dst = y * (1 + w * 4) + 1 + x * 4;
      raw[dst]   = pixels[src];
      raw[dst+1] = pixels[src+1];
      raw[dst+2] = pixels[src+2];
      raw[dst+3] = pixels[src+3];
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),  // PNG signature
    writeChunk('IHDR', ihdr),
    writeChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    writeChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Drawing primitives ───────────────────────────────────────────────────────
function makeCanvas(size) {
  const buf = new Uint8Array(size * size * 4);   // all transparent

  function setPixel(x, y, r, g, b, a) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = a;
  }

  // Alpha-blend fg over whatever is already in the buffer
  function blendPixel(x, y, [r, g, b], alpha) {
    if (x < 0 || x >= size || y < 0 || y >= size || alpha <= 0) return;
    const i = (y * size + x) * 4;
    const ea = buf[i+3] / 255;
    const na = alpha + ea * (1 - alpha);
    if (na <= 0) return;
    buf[i]   = Math.round((r * alpha + buf[i]   * ea * (1 - alpha)) / na);
    buf[i+1] = Math.round((g * alpha + buf[i+1] * ea * (1 - alpha)) / na);
    buf[i+2] = Math.round((b * alpha + buf[i+2] * ea * (1 - alpha)) / na);
    buf[i+3] = Math.round(na * 255);
  }

  // Draw a thick anti-aliased line (Wu-style width)
  function drawLine(x0, y0, x1, y1, halfWidth, color) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return;
    const nx = -dy / len, ny = dx / len;  // unit normal
    const steps = Math.ceil(len * 2) + 1;
    for (let s = 0; s <= steps; s++) {
      const t  = s / steps;
      const cx = x0 + dx * t, cy = y0 + dy * t;
      // Sweep across the half-width + 1 pixel for AA
      const sweep = halfWidth + 1.5;
      for (let d = -sweep; d <= sweep; d += 0.5) {
        const px = cx + nx * d, py = cy + ny * d;
        const dist = Math.abs(d);
        const alpha = Math.max(0, Math.min(1, halfWidth + 0.5 - dist));
        if (alpha > 0) blendPixel(Math.round(px), Math.round(py), color, alpha);
      }
    }
  }

  // Rounded-rect fill — anti-aliased at corners
  function fillRoundedRect(r, color) {
    const cr = r; // corner radius
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Find the closest "corner anchor" and measure distance
        const cx = Math.max(cr, Math.min(size - 1 - cr, x));
        const cy = Math.max(cr, Math.min(size - 1 - cr, y));
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        // AA on the corner edge
        const alpha = Math.max(0, Math.min(1, cr + 0.5 - dist));
        if (alpha > 0) blendPixel(x, y, color, alpha);
      }
    }
  }

  return { buf, setPixel, blendPixel, drawLine, fillRoundedRect };
}

// ─── Icon renderer ────────────────────────────────────────────────────────────
function generateIcon(size) {
  const { buf, drawLine, fillRoundedRect } = makeCanvas(size);

  const cornerR = Math.round(size * 0.2);
  fillRoundedRect(cornerR, AMBER);

  // "M" geometry — proportional to size
  const sw  = size * 0.105;          // stroke half-width
  const padX = size * 0.195;
  const mL   = padX;
  const mR   = size - padX;
  const mT   = size * 0.215;
  const mB   = size * 0.785;
  const mMX  = size / 2;
  const mMY  = mT + (mB - mT) * 0.42;

  drawLine(mL,  mB,  mL,  mT,  sw, DARK);   // left vertical
  drawLine(mL,  mT,  mMX, mMY, sw, DARK);   // left diagonal
  drawLine(mMX, mMY, mR,  mT,  sw, DARK);   // right diagonal
  drawLine(mR,  mT,  mR,  mB,  sw, DARK);   // right vertical

  return buf;
}

// ─── Write files ──────────────────────────────────────────────────────────────
const assetsDir = path.join(__dirname, 'meetscribe', 'assets');

for (const size of [16, 48, 128]) {
  const pixels = generateIcon(size);
  const png    = encodePNG(pixels, size, size);
  const dest   = path.join(assetsDir, `icon-${size}.png`);
  fs.writeFileSync(dest, png);
  console.log(`✓ icon-${size}.png  (${png.length} bytes)`);
}
console.log('Done.');
