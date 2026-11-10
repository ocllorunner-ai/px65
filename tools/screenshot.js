// ROMを指定フレーム数だけ実行し、画面をPNGに書き出す(ブラウザなしで動作確認するため)
//
//   node tools/screenshot.js <rom.bin> <out.png> [--frames 60] [--scale 4]

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Machine } from '../src/machine.js';
import { LCD_WIDTH, LCD_HEIGHT } from '../src/bus.js';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// RGBのPNGを作る。pixel(x, y) は [r, g, b] を返す
export function encodePNG(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // フィルタなし
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), row + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8ビット、RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function screenshotPNG(lcd, scale = 4, border = 2) {
  const ON = [0x22, 0x2b, 0x1e], OFF = [0xa7, 0xb8, 0x93];
  const w = (LCD_WIDTH + border * 2) * scale, h = (LCD_HEIGHT + border * 2) * scale;
  return encodePNG(w, h, (x, y) => {
    const dx = Math.floor(x / scale) - border, dy = Math.floor(y / scale) - border;
    if (dx < 0 || dy < 0 || dx >= LCD_WIDTH || dy >= LCD_HEIGHT) return OFF;
    // ドットの間にすき間を入れて液晶らしく見せる
    if (scale >= 3 && (x % scale === scale - 1 || y % scale === scale - 1)) return OFF;
    return lcd[dy * LCD_WIDTH + dx] ? ON : OFF;
  });
}

function main(argv) {
  let rom, out, frames = 60, scale = 4;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--frames') frames = Number(argv[++i]);
    else if (argv[i] === '--scale') scale = Number(argv[++i]);
    else if (!rom) rom = argv[i];
    else out = argv[i];
  }
  if (!rom || !out) {
    console.error('usage: node tools/screenshot.js <rom.bin> <out.png> [--frames 60] [--scale 4]');
    process.exit(2);
  }
  const m = new Machine();
  m.loadROM(readFileSync(rom));
  m.powerOn();
  for (let f = 0; f < frames; f++) m.runFrame();
  writeFileSync(out, screenshotPNG(m.bus.renderLCD(), scale));
  console.log(`${out}: after ${frames} frames, PC=$${m.cpu.pc.toString(16).toUpperCase()}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
