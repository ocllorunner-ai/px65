// 内蔵ROM(24KB)を作る: rom/basic.s($A000-$DFFF)と rom/monitor.s($E000-$FFFF)を
// それぞれアセンブルして1つにまとめる
//
//   node tools/rom.js            # rom/px65.bin と、rom/basic.lst、rom/monitor.lst を書き出す
//
// テストからは buildRom() を呼ぶ(ファイルは書かない)。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble } from './asm.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function part(file, lo, hi) {
  const path = join(root, file);
  const r = assemble(readFileSync(path, 'utf8'), path);
  for (let a = 0; a < 0x10000; a++) {
    if (r.written[a] && (a < lo || a > hi)) {
      throw new Error(`${file}: $${a.toString(16).toUpperCase()} は $${lo.toString(16).toUpperCase()}-$${hi.toString(16).toUpperCase()} の外です`);
    }
  }
  return r;
}

export function buildRom() {
  const basic = part('rom/basic.s', 0xa000, 0xdfff);
  const monitor = part('rom/monitor.s', 0xe000, 0xffff);
  const bin = new Uint8Array(0x6000);
  bin.set(basic.mem.subarray(0xa000, 0xe000), 0);
  bin.set(monitor.mem.subarray(0xe000, 0x10000), 0x4000);
  return { bin, basic, monitor };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { bin, basic, monitor } = buildRom();
    writeFileSync(join(root, 'rom/px65.bin'), bin);
    writeFileSync(join(root, 'rom/basic.lst'), basic.listing + '\n');
    writeFileSync(join(root, 'rom/monitor.lst'), monitor.listing + '\n');
    const used = (r, lo, hi) => { let n = 0; for (let a = lo; a <= hi; a++) n += r.written[a]; return n; };
    console.log(`rom/px65.bin: 24576 bytes (BASIC ${used(basic, 0xa000, 0xdfff)} / 16384, monitor ${used(monitor, 0xe000, 0xffff)} / 8192)`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
