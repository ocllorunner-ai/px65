// Klaus Dormannの割り込みのテスト(6502_interrupt_test.a65)を実行する。
//
//   node test/interrupt.js <6502_interrupt_test.a65 のパス>
//
// テストは「フィードバックポート」に書いて自分で IRQ と NMI を起こす。ここでは $BFFC に
// ポートを置き(テストの既定)、ビット0 が 0 の間 IRQ を出し、ビット1 が 1 から 0 になったら NMI を出す
// (I_drive = 0: プッシュプル)。65C02 なので、割り込みで D フラグが消えることも確かめる(D_clear = 1)。
// ソースは test/as65.js で tools/asm.js の書式に直してからアセンブルする。

import { readFileSync } from 'node:fs';
import { assemble } from '../tools/asm.js';
import { CPU65C02 } from '../src/cpu65c02.js';
import { convertAs65 } from './as65.js';

const [path] = process.argv.slice(2);
if (!path) {
  console.error('usage: node test/interrupt.js <6502_interrupt_test.a65>');
  process.exit(2);
}

const I_PORT = 0xbffc;
let passCount = 0;
const source = convertAs65(readFileSync(path, 'utf8'), {
  settings: { I_port: I_PORT, I_drive: 0, I_ddr: 0, IRQ_bit: 0, NMI_bit: 1, D_clear: 1, report: 0, load_data_direct: 1 },
  macros: { success: () => { const l = `passed${passCount++}`; return [`${l}:`, `        jmp ${l}`]; } },   // 成功した場所が分かるように
});
const r = assemble(source, path);
const sym = (n) => r.symbols[n.toUpperCase()] ?? r.symbols[n];

const mem = new Uint8Array(0x10000);
mem.set(r.mem.subarray(0, 0x10000));
let port = 0xff;
let irqLine = false;
const cpu = new CPU65C02({
  read: (a) => (a === I_PORT ? port : mem[a]),
  write: (a, v) => {
    if (a !== I_PORT) { mem[a] = v; return; }
    if ((port & 2) && !(v & 2)) cpu.nmi();      // NMI はビット1 が下がったとき
    port = v;
    irqLine = !(port & 1);                     // IRQ はビット0 が 0 の間
  },
});
cpu.pc = sym('start');
let n = 0, irqs = 0, nmis = 0, brks = 0;
const [vNmi, vIrq] = [mem[0xfffa] | (mem[0xfffb] << 8), mem[0xfffe] | (mem[0xffff] << 8)];
for (;;) {
  const pc = cpu.pc;
  const op = mem[pc];
  cpu.setIRQ(irqLine);
  cpu.step();
  if (cpu.pc === vNmi) nmis++;                 // 数える(テストが本当に割り込みを起こしているか)
  else if (cpu.pc === vIrq) { if (op === 0x00) brks++; else irqs++; }
  n++;
  if (cpu.pc === pc && !cpu.waiting) break;   // 自分自身へのジャンプ(成功か失敗)
  if (n > 50_000_000) { console.log('timeout'); process.exit(1); }
}
const hex = (v, w = 4) => v.toString(16).toUpperCase().padStart(w, '0');
const passed = Array.from({ length: passCount }, (_, i) => sym(`passed${i}`));
if (passed.includes(cpu.pc)) {
  console.log(`PASS  ${n.toLocaleString()} instructions, ${irqs} IRQ, ${nmis} NMI, ${brks} BRK, success at passed${passed.indexOf(cpu.pc)} of ${passCount}`);
  process.exit(0);
}
// 失敗した場所(テストのリストと見比べられるように、近いラベルも出す)
const near = Object.entries(r.symbols).filter(([, v]) => v <= cpu.pc && v >= 0x400).sort((a, b) => b[1] - a[1])[0];
console.log(`FAIL  trapped at $${hex(cpu.pc)} (after ${near ? near[0] : '?'} $${hex(near?.[1] ?? 0)}) ` +
  `A=${hex(cpu.a, 2)} X=${hex(cpu.x, 2)} Y=${hex(cpu.y, 2)} P=${hex(cpu.p, 2)} S=${hex(cpu.s, 2)}`);
process.exit(1);
