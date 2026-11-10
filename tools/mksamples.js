// サンプルのプログラム(samples/*.bas)をテープのファイル samples/samples.tap にする
//
//   node tools/mksamples.js      (npm run samples でも同じ)
//
// 内蔵ROMの BASIC を動かして、1本ずつ打ち込んで SAVE する。テープの中身は、
// エミュレーターで SAVE したものとまったく同じになる。
// test/dist.test.js は、samples.tap が作り直したものと同じかを確かめる。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootBasic } from '../test/basic_harness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// テープに入れる順
export const SAMPLES = ['HELLO', 'KAZUATE', 'SINWAVE', 'BOUNCE', 'MUSIC', 'CATCH', 'ABC'];

export function buildSamplesTape() {
  const b = bootBasic();
  b.m.bus.insertTape(new Uint8Array(0));
  for (const name of SAMPLES) {
    b.run('NEW');
    const lines = readFileSync(join(root, 'samples', `${name}.bas`), 'utf8').split(/\r?\n/).filter((l) => l.trim());
    for (const line of lines) {
      if (line.length > 58) throw new Error(`${name}.bas: 1行は58文字まで: ${line}`);
      const out = b.run(line);
      if (/ERROR|timeout/.test(out)) throw new Error(`${name}.bas: ${line}: ${out}`);
    }
    const out = b.run(`SAVE "${name}"`);
    if (/ERROR|timeout/.test(out)) throw new Error(`${name}: SAVE: ${out}`);
  }
  return Uint8Array.from(b.m.bus.tape);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tape = buildSamplesTape();
  writeFileSync(join(root, 'samples/samples.tap'), tape);
  console.log(`samples/samples.tap: ${tape.length} bytes (${SAMPLES.join(', ')})`);
}
