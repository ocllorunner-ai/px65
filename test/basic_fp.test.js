// BASIC の浮動小数点のテスト
//   node test/basic_fp.test.js
//
// ROM のルーチンを直接呼び、JavaScript で計算した値と比べる。

import { buildRom } from '../tools/rom.js';
import { encodeFloat, decodeFloat } from '../tools/mkfpconst.js';
import { Machine } from '../src/machine.js';
import { watchMachine, PROFILE_PX65 } from './watch.js';

const ROM = buildRom();
const { bin, basic } = ROM;
const S = basic.symbols;

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ok    ${name}`); return; }
  failures++;
  console.log(`  FAIL  ${name} ${detail}`);
}

const m = watchMachine(new Machine(), PROFILE_PX65(ROM));
m.loadROM(bin);
m.powerOn();
for (let i = 0; i < 10; i++) m.runFrame();

// FAC / ARG に値を置く(アンパックした形)
function setReg(base, v) {
  const b = encodeFloat(v);
  const ram = m.bus.ram;
  ram[base] = b[0];
  ram[base + 1] = b[1] | 0x80;
  ram[base + 2] = b[2];
  ram[base + 3] = b[3];
  ram[base + 4] = b[4];
  ram[base + 5] = b[1] & 0x80;
  ram[base + 6] = 0;
}
function getFac() {
  const r = m.bus.ram;
  const b = [r[S.FAC_E], (r[S.FAC_M1] & 0x7f) | (r[S.FAC_S] & 0x80), r[S.FAC_M2], r[S.FAC_M3], r[S.FAC_M4]];
  return decodeFloat(b);
}

// ルーチンを呼んで、丸めた FAC を返す。エラーなら { error: 番号 }
function call(addr, setup = () => {}, round = true) {
  setup();
  const r = round ? [0x20, S.FAC_ROUND & 0xff, S.FAC_ROUND >> 8] : [0xea, 0xea, 0xea];
  m.bus.ram.set([0x20, addr & 0xff, addr >> 8, ...r, 0xdb], 0x700);
  m.cpu.stopped = false;
  m.cpu.waiting = false;
  m.cpu.pc = 0x700;
  m.cpu.s = 0xf0;
  for (let n = 0; n < 2_000_000; n++) {
    if (m.cpu.pc === S.B_ERROR) return { error: m.cpu.x };
    if (m.cpu.stopped) return getFac();
    m.step();
  }
  return { error: 'timeout' };
}

// 32ビットの仮数に丸めた値
const q = (v) => decodeFloat(encodeFloat(v));
const close = (a, b, rel = 2 ** -30) => (b === 0 ? a === 0 : Math.abs(a - b) <= Math.abs(b) * rel);

// 再現できる乱数
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const rndNum = () => {
  const v = (rnd() - 0.5) * 2 ** Math.floor(rnd() * 60 - 30);
  return q(v);
};

console.log('round trip');
{
  for (const v of [1, -1, 0.5, 3.14159, 1e30, -2.5e-30, 123456789]) {
    check(`encode/decode ${v}`, close(decodeFloat(encodeFloat(v)), v));
  }
}

function binop(name, addr, fn, n = 300) {
  let bad = 0;
  let first = '';
  for (let i = 0; i < n; i++) {
    const a = rndNum(), b = rndNum();
    if (name === 'fdiv' && b === 0) continue;
    const got = call(addr, () => { setReg(S.ARG_E, a); setReg(S.FAC_E, b); });
    const want = fn(a, b);
    if (typeof got === 'object' || !close(got, want)) {
      if (!bad) first = `${a} , ${b}: got ${JSON.stringify(got)} want ${want}`;
      bad++;
    }
  }
  check(`${name} (${n} random)`, bad === 0, `${bad} bad. first: ${first}`);
}

console.log('arithmetic');
binop('fadd', S.FADD, (a, b) => a + b);
binop('fsub', S.FSUB, (a, b) => a - b);
binop('fmul', S.FMUL, (a, b) => a * b);
binop('fdiv', S.FDIV, (a, b) => a / b);
{
  check('1 - 1 = 0', call(S.FSUB, () => { setReg(S.ARG_E, 1); setReg(S.FAC_E, 1); }) === 0);
  check('0 + 5 = 5', call(S.FADD, () => { setReg(S.ARG_E, 0); setReg(S.FAC_E, 5); }) === 5);
  check('5 + 0 = 5', call(S.FADD, () => { setReg(S.ARG_E, 5); setReg(S.FAC_E, 0); }) === 5);
  check('0 * 5 = 0', call(S.FMUL, () => { setReg(S.ARG_E, 0); setReg(S.FAC_E, 5); }) === 0);
  check('x / 0 is /0 error', call(S.FDIV, () => { setReg(S.ARG_E, 1); setReg(S.FAC_E, 0); }).error === S.EN_DIV0);
  check('overflow', call(S.FMUL, () => { setReg(S.ARG_E, 1e30); setReg(S.FAC_E, 1e30); }).error === S.EN_OV);
  check('underflow to 0', call(S.FMUL, () => { setReg(S.ARG_E, 1e-30); setReg(S.FAC_E, 1e-30); }) === 0);
  check('1/3*3 = 1', close(call(S.FMUL, () => { setReg(S.ARG_E, q(1 / 3)); setReg(S.FAC_E, 3); }), 1));
}

console.log('INT');
{
  const cases = [[3.7, 3], [-3.7, -4], [-3, -3], [0.5, 0], [-0.5, -1], [123456.999, 123456], [1e12 + 0.5, 1e12], [-1e-5, -1]];
  for (const [v, want] of cases) {
    check(`INT(${v}) = ${want}`, call(S.FAC_INT, () => setReg(S.FAC_E, q(v))) === want);
  }
}

console.log('compare');
{
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    const a = rndNum(), b = i % 10 === 0 ? a : rndNum();
    call(S.FCMP, () => { setReg(S.ARG_E, a); setReg(S.FAC_E, b); }, false);
    const got = m.cpu.a;
    const want = a > b ? 1 : a < b ? 0xff : 0;
    if (got !== want) bad++;
  }
  check('fcmp (200 random)', bad === 0, `${bad} bad`);
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
