// Klaus Dormannの機能テスト(64KBのバイナリ)を実行する。
//
//   node test/functional.js <binファイル> <成功アドレス(16進)>
//
// テストは失敗すると、その場所で無限ループ(自分自身へのジャンプや分岐)に入る。
// PCが変わらなくなったら止めて、成功アドレスと一致するかを見る。

import { readFileSync } from 'node:fs';
import { CPU65C02 } from '../src/cpu65c02.js';

const [binPath, successHex] = process.argv.slice(2);
if (!binPath || !successHex) {
  console.error('usage: node test/functional.js <bin> <success address hex>');
  process.exit(2);
}

const mem = new Uint8Array(0x10000);
mem.set(readFileSync(binPath));
const cpu = new CPU65C02({ read: (a) => mem[a], write: (a, v) => { mem[a] = v; } });
cpu.pc = 0x0400;

const success = parseInt(successHex, 16);
const t0 = Date.now();
let instructions = 0;
for (;;) {
  const pc = cpu.pc;
  cpu.step();
  instructions++;
  if (cpu.pc === pc) break;
  if (instructions > 200_000_000) { console.log('timeout'); process.exit(1); }
}

const hex = (v, n = 4) => v.toString(16).toUpperCase().padStart(n, '0');
const sec = (Date.now() - t0) / 1000;
const mips = (instructions / sec / 1e6).toFixed(1);
const regs = `A=${hex(cpu.a, 2)} X=${hex(cpu.x, 2)} Y=${hex(cpu.y, 2)} P=${hex(cpu.p, 2)} S=${hex(cpu.s, 2)}`;
if (cpu.pc === success) {
  console.log(`PASS  ${instructions.toLocaleString()} instructions, ${cpu.cycles.toLocaleString()} cycles, ${sec}s (${mips} M instr/s)`);
  process.exit(0);
} else {
  console.log(`FAIL  trapped at $${hex(cpu.pc)}  ${regs}  test case $${hex(mem[0x0200], 2)}`);
  process.exit(1);
}
