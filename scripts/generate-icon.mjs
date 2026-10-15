import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const WIDTH = 256;
const HEIGHT = 256;

// Colors matching the reference image:
// Warm cream parchment (#F5EDE0) & deep forest engraving green (#213A24)
const BG = [245, 237, 224, 255];
const INK = [33, 58, 36, 255];
const TRANSPARENT = [0, 0, 0, 0];

const pixels = new Uint8Array(WIDTH * HEIGHT * 4);

function setPixel(x, y, rgba, alphaBlend = 1.0) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || ix >= WIDTH || iy < 0 || iy >= HEIGHT) return;
  const idx = (iy * WIDTH + ix) * 4;
  if (alphaBlend >= 0.99 || pixels[idx + 3] === 0) {
    pixels[idx] = rgba[0];
    pixels[idx + 1] = rgba[1];
    pixels[idx + 2] = rgba[2];
    pixels[idx + 3] = rgba[3];
  } else {
    pixels[idx] = Math.round(pixels[idx] * (1 - alphaBlend) + rgba[0] * alphaBlend);
    pixels[idx + 1] = Math.round(pixels[idx + 1] * (1 - alphaBlend) + rgba[1] * alphaBlend);
    pixels[idx + 2] = Math.round(pixels[idx + 2] * (1 - alphaBlend) + rgba[2] * alphaBlend);
    pixels[idx + 3] = 255;
  }
}

function drawDisk(cx, cy, r, rgba) {
  const r2 = (r + 0.5) * (r + 0.5);
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 <= r2) {
        const dist = Math.sqrt(d2);
        const aa = Math.max(0, Math.min(1, r + 0.5 - dist));
        setPixel(x, y, rgba, aa);
      }
    }
  }
}

function drawLine(x0, y0, x1, y1, thickness, rgba, dashed = false) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len * 2));
  for (let i = 0; i <= steps; i++) {
    if (dashed && Math.floor(i / 10) % 2 === 1) continue;
    const t = i / steps;
    drawDisk(x0 + dx * t, y0 + dy * t, thickness / 2, rgba);
  }
}

function drawQuadCurve(x0, y0, cx, cy, x1, y1, thickness, rgba, dashed = false) {
  const steps = 220;
  for (let i = 0; i <= steps; i++) {
    if (dashed && Math.floor(i / 8) % 2 === 1) continue;
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
    const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
    drawDisk(x, y, thickness / 2, rgba);
  }
}

function insideRoundedRect(x, y, w, h, r) {
  const qx = Math.max(Math.abs(x - w / 2) - (w / 2 - r), 0);
  const qy = Math.max(Math.abs(y - h / 2) - (h / 2 - r), 0);
  return Math.hypot(qx, qy) <= r;
}

// 1. Fill rounded parchment badge background
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    if (insideRoundedRect(x, y, WIDTH, HEIGHT, 42)) {
      setPixel(x, y, BG);
    } else {
      setPixel(x, y, TRANSPARENT);
    }
  }
}

// 2. Engraved Pyramid / Triangle outline
const topX = 128, topY = 26;
const leftX = 24, leftY = 216;
const rightX = 232, rightY = 216;

drawLine(topX, topY, rightX, rightY, 5.5, INK);
drawLine(rightX, rightY, leftX, leftY, 5.5, INK);
drawLine(leftX, leftY, topX, topY, 5.5, INK);

// Inner dashed triangle
drawLine(128, 39, 219, 207, 2.2, INK, true);
drawLine(219, 207, 37, 207, 2.2, INK, true);
drawLine(37, 207, 128, 39, 2.2, INK, true);

// 3. Woodcut horizontal/curved hatching lines in top peak & base
for (let y = 55; y <= 96; y += 9) {
  const halfSpan = ((y - topY) / (leftY - topY)) * (128 - leftX) - 9;
  if (halfSpan > 6) {
    drawQuadCurve(128 - halfSpan, y, 128, y - 4, 128 + halfSpan, y, 2.2, INK, true);
  }
}

// Engraved brow / cloud ridge above the eye
drawQuadCurve(78, 112, 128, 86, 178, 112, 5.0, INK, false);
drawQuadCurve(72, 120, 128, 94, 184, 120, 2.6, INK, true);

// Cross-hatching rays on left, right, and bottom of triangle
for (let x = 44; x <= 212; x += 13) {
  const targetX = 128 + (x - 128) * 0.58;
  drawLine(x, 206, targetX, 174, 2.3, INK, true);
}
for (let i = 0; i < 5; i++) {
  drawLine(50 + i * 7, 165 + i * 7, 82 + i * 4, 130 + i * 5, 2.3, INK);
  drawLine(206 - i * 7, 165 + i * 7, 174 - i * 4, 130 + i * 5, 2.3, INK);
}

// 4. Clear interior of eye & draw bold almond eye contour
for (let y = 112; y <= 184; y++) {
  for (let x = 66; x <= 190; x++) {
    const nx = (x - 128) / 60;
    const ny = (y - 148) / 28;
    if (nx * nx + ny * ny <= 0.92) {
      setPixel(x, y, BG);
    }
  }
}

drawQuadCurve(66, 148, 128, 98, 190, 148, 6.2, INK, false);
drawQuadCurve(66, 148, 128, 198, 190, 148, 6.2, INK, false);
drawQuadCurve(74, 148, 128, 108, 182, 148, 2.2, INK, true);
drawQuadCurve(76, 164, 128, 204, 180, 164, 3.6, INK, false);

// 5. Iris & concentric woodcut rings
drawDisk(128, 146, 28, INK);
for (const r of [23, 18, 13]) {
  for (let a = 0; a < 360; a += 3) {
    if ((a > 35 && a < 65) || (a > 200 && a < 235)) continue;
    const rad = (a * Math.PI) / 180;
    drawDisk(128 + Math.cos(rad) * r, 146 + Math.sin(rad) * r, 1.3, BG);
  }
}

// Specular catchlights in iris
drawDisk(116, 137, 5.5, BG);
drawDisk(139, 134, 2.8, BG);

// Encode as valid PNG
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const rawScanlines = Buffer.alloc(HEIGHT * (1 + WIDTH * 4));
for (let y = 0; y < HEIGHT; y++) {
  const rowStart = y * (1 + WIDTH * 4);
  rawScanlines[rowStart] = 0; // filter type 0
  Buffer.from(pixels.buffer, y * WIDTH * 4, WIDTH * 4).copy(rawScanlines, rowStart + 1);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const idat = zlib.deflateSync(rawScanlines, { level: 9 });
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pngBuffer = Buffer.concat([
  pngSignature,
  makeChunk('IHDR', ihdr),
  makeChunk('IDAT', idat),
  makeChunk('IEND', Buffer.alloc(0)),
]);

// Wrap 256x256 PNG into a standard Windows ICO file
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0); // Reserved
icoHeader.writeUInt16LE(1, 2); // Type 1 = ICO
icoHeader.writeUInt16LE(1, 4); // 1 image

const icoDirEntry = Buffer.alloc(16);
icoDirEntry[0] = 0; // 0 means 256px width
icoDirEntry[1] = 0; // 0 means 256px height
icoDirEntry[2] = 0; // Palette
icoDirEntry[3] = 0; // Reserved
icoDirEntry.writeUInt16LE(1, 4); // Color planes
icoDirEntry.writeUInt16LE(32, 6); // Bits per pixel
icoDirEntry.writeUInt32LE(pngBuffer.length, 8); // Image size
icoDirEntry.writeUInt32LE(22, 12); // Offset (6 + 16)

const icoBuffer = Buffer.concat([icoHeader, icoDirEntry, pngBuffer]);

const buildDir = path.resolve('build');
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'icon.png'), pngBuffer);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);
console.log('Generated build/icon.png and build/icon.ico successfully.');
