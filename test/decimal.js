// Klaus Dormannの10進モード(BCD)のテスト(6502_decimal_test.a65)を実行する。
//
//   node test/decimal.js <6502_decimal_test.a65 のパス> [cputype] [all]
//
// テストは as65 アセンブラ用のソースしか配布されていないので、test/as65.js で
// tools/asm.js の書式に直してからアセンブルする。
// 既定は 65C02(cputype = 1)で、A と N、V、Z、C のすべてのフラグを確かめる。
// 正しくない BCD の値($0A-$0F など)も含め、2つの数の全組み合わせ × キャリー2通りを、
// ADC と SBC で試す。STP($DB)で止まったとき、ERROR が 0 なら成功。

import { readFileSync } from 'node:fs';
import { assemble } from '../tools/asm.js';
import { convertAs65 } from './as65.js';
import { CPU65C02 } from '../src/cpu65c02.js';

const [path, cpuArg = '1', allArg = 'all'] = process.argv.slice(2);
if (!path) {
  console.error('usage: node test/decimal.js <6502_decimal_test.a65> [cputype 0|1] [all|default]');
  process.exit(2);
}

// 設定: cputype(0 = 6502、1 = 65C02)、すべてのフラグを確かめる、正しくない BCD も試す
const settings = { cputype: Number(cpuArg), vld_bcd: 0 };
if (allArg === 'all') Object.assign(settings, { chk_a: 1, chk_n: 1, chk_v: 1, chk_z: 1, chk_c: 1 });

const source = convertAs65(readFileSync(path, 'utf8'), {
  settings,
  macros: { end_of_test: () => ['        .byte $DB'] },   // STP で止める
});
const r = assemble(source, path);
const sym = (n) => r.symbols[n.toUpperCase()] ?? r.symbols[n];
const mem = new Uint8Array(0x10000);
mem.set(r.mem.subarray(0, 0x10000));
const cpu = new CPU65C02({ read: (a) => mem[a], write: (a, v) => { mem[a] = v; } });
cpu.pc = sym('TEST');
cpu.s = 0xff;
let n = 0;
const t0 = Date.now();
while (!cpu.stopped) {
  cpu.step();
  if (++n > 200_000_000) { console.log('timeout'); process.exit(1); }
}
const err = mem[sym('ERROR')];
const checked = Object.entries(settings).filter(([k, v]) => k.startsWith('chk_') && v).map(([k]) => k.slice(4).toUpperCase());
const what = `cputype ${settings.cputype}, checks ${checked.length ? checked.join(' ') : '(defaults)'}`;
const sec = ((Date.now() - t0) / 1000).toFixed(1);
if (err === 0) {
  console.log(`PASS  ${what}: ${n.toLocaleString()} instructions, ${sec}s`);
  process.exit(0);
}
const h = (v) => v.toString(16).toUpperCase().padStart(2, '0');
console.log(`FAIL  ${what}: N1=${h(mem[sym('N1')])} N2=${h(mem[sym('N2')])} carry=${cpu.y} ` +
  `A=${h(mem[sym('DA')])} (expected ${h(mem[sym('AR')])}) flags=${h(mem[sym('DNVZC')])}`);
process.exit(1);
