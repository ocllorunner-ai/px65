// BASIC の数学関数を、JavaScript の倍精度の計算と比べるテスト
//
//   node test/basic_math.test.js                       # npm test で使う(種1、各 200 件)
//   npm run mathcheck -- --count 20000 --seed 5        # 大きく回す。誤差の分布と最悪の件を表示する
//   npm run mathcheck -- --only POW --count 5000       # 名前に POW を含む項目だけ
//
// ROM のルーチンを直接呼び(test/basic_fp.test.js と同じ方法)、答えの誤差を
// 「仮数の最後の1ビット」(ulp。2^(指数-32)。答えの約 2.3E-10〜4.7E-10)の何個分かで測る。
// 基準(LIMIT)を超えた件があれば失敗にする。基準は、表示の9桁がおおむね合う範囲を目安に、
// 測った最大より少し余裕を取った(docs/basic.md の「速さと制限」の精度の説明と合わせる)。
//
// 比べる相手は、ROM が受け取った数(32ビットに丸めた引数)に対する正しい値。
// 度の三角関数は、ROM と同じように 90 度で正確に分けてから倍精度で計算する
// (90 度の倍数の近くでは、x × π/180 を倍精度で計算すると、正しい値の相手にならないため)。
//
// ほかに、決まった値、エラーになる境目、BASIC で表示したときの文字も調べる。
// test/watch.js の見張りが付く。

import { buildRom } from '../tools/rom.js';
import { encodeFloat, decodeFloat } from '../tools/mkfpconst.js';
import { Machine } from '../src/machine.js';
import { watchMachine, PROFILE_PX65 } from './watch.js';
import { bootBasic } from './basic_harness.js';

// ---- 引数 ----
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const SEED = Number(opt('seed', 1));
const COUNT = Number(opt('count', 200));
const ONLY = opt('only', null);
const REPORT = args.includes('--report') || args.includes('--count');

const ROM = buildRom();
const { bin, basic } = ROM;
const S = basic.symbols;

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ok    ${name}`); return; }
  failures++;
  console.log(`  FAIL  ${name} ${detail}`);
}

// ---- ROM のルーチンを直接呼ぶ ----
const m = watchMachine(new Machine(), PROFILE_PX65(ROM));
m.loadROM(bin);
m.powerOn();
for (let i = 0; i < 10; i++) m.runFrame();
const ram = m.bus.ram;

function setReg(base, v) {
  const b = encodeFloat(v);
  ram.set([b[0], b[1] | 0x80, b[2], b[3], b[4], b[1] & 0x80, 0], base);
}
function getFac() {
  const r = ram;
  return decodeFloat([r[S.FAC_E], (r[S.FAC_M1] & 0x7f) | (r[S.FAC_S] & 0x80), r[S.FAC_M2], r[S.FAC_M3], r[S.FAC_M4]]);
}
// addr を呼んで(round なら丸めて)FAC を返す。エラーなら { error: 番号 }
function call(addr, setup, round = true) {
  setup();
  const r = round ? [0x20, S.FAC_ROUND & 0xff, S.FAC_ROUND >> 8] : [0xea, 0xea, 0xea];
  ram.set([0x20, addr & 0xff, addr >> 8, ...r, 0xdb], 0x700);
  m.cpu.stopped = false;
  m.cpu.waiting = false;
  m.cpu.pc = 0x700;
  m.cpu.s = 0xf0;
  for (let n = 0; n < 3_000_000; n++) {
    if (m.cpu.pc === S.B_ERROR) return { error: m.cpu.x };
    if (m.cpu.stopped) return getFac();
    m.step();
  }
  return { error: 'timeout' };
}
// 関数の入口(fn_sin など)は、最初に jsr par_num で括弧の中を読む。その次から呼ぶ
const afterPar = (label) => {
  const a = S[label];
  if (bin[a - 0xa000] !== 0x20 || bin[a - 0xa000 + 1] !== (S.PAR_NUM & 0xff) || bin[a - 0xa000 + 2] !== (S.PAR_NUM >> 8)) {
    throw new Error(`${label} does not start with jsr par_num`);
  }
  return a + 3;
};
const unary = (addr, ang = 0) => (x) => call(addr, () => { ram[S.ANGMODE] = ang; setReg(S.FAC_E, x); });
const pow = (x, y) => call(S.FPOW, () => { setReg(S.ARG_E, x); setReg(S.FAC_E, y); });
// VAL: 文字列を txtptr に置いて fin を呼ぶ
function val(s) {
  ram.set([...Buffer.from(s + '\0', 'latin1')], 0x600);
  return call(S.FIN, () => { ram[S.TXTPTR] = 0x00; ram[S.TXTPTR + 1] = 0x06; });
}
// STR$: fout の結果(先頭は符号の場所)
function str(v) {
  call(S.FOUT, () => setReg(S.FAC_E, v), false);
  let s = '';
  for (let i = S.FBUFFR; ram[i]; i++) s += String.fromCharCode(ram[i]);
  return s;
}

// ---- 数の道具 ----
const q = (v) => decodeFloat(encodeFloat(v));             // 32ビットの仮数に丸める
const ulp = (v) => 2 ** (Math.floor(Math.log2(Math.abs(v))) + 1 - 32);
const inRange = (v) => v === 0 || (Math.abs(v) < 2 ** 126 && Math.abs(v) > 2 ** -126);
// 誤差(ulp)。正しい値が 0 なら、ちょうど 0 のときだけ 0
const errUlp = (got, want) => (want === 0 ? (got === 0 ? 0 : Infinity) : Math.abs(got - want) / ulp(want));

// 種から決まる乱数(項目ごとに別の列)
function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function rng(seedText) {
  let a = hash(seedText);
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    uni: (lo, hi) => q(lo + (hi - lo) * next()),                           // 一様
    log: (lo, hi) => q(2 ** (lo + (hi - lo) * next())),                    // 2^lo〜2^hi(対数で一様)
    slog: (lo, hi) => q((next() < 0.5 ? -1 : 1) * 2 ** (lo + (hi - lo) * next())),
  };
}

// 度の三角関数の正しい値。ROM と同じく 90 度で正確に分ける(x は 32 ビットなので % 90 は正確)
const D = Math.PI / 180;
function degParts(x) {
  const a = Math.abs(x);
  const r = a % 90;                       // 0 <= r < 90(正確)
  const k = Math.round((a - r) / 90) % 4;
  const sinr = r <= 45 ? Math.sin(r * D) : Math.cos((90 - r) * D);
  const cosr = r <= 45 ? Math.cos(r * D) : Math.sin((90 - r) * D);
  return { neg: x < 0, k, sinr, cosr };
}
function sinDeg(x) {
  const { neg, k, sinr, cosr } = degParts(x);
  const v = [sinr, cosr, -sinr, -cosr][k];
  return neg ? -v : v;
}
function cosDeg(x) {
  const { k, sinr, cosr } = degParts(x);
  return [cosr, -sinr, -cosr, sinr][k];
}
const tanDeg = (x) => sinDeg(x) / cosDeg(x);

// ---- 誤差を比べる項目 ----
// gen(r) は引数の配列。ref(...args) は正しい値(範囲外・定義されないなら NaN を返して飛ばす)。
// limit(want, args) は許す誤差(ulp)。abs があれば、誤差を絶対値で測る(その値以下なら合格)
// ラジアンでは π/2 の倍数を引くので、π/2 を有限の桁(約64ビット。0.11.10 で5つに分けた)で持つ分の
// 絶対誤差が、およそ |x| × 2^-72 残る(0.11.9 は4つに分けていて |x| × 2^-64)。
// 答えが引数に比べてとても 0 に近い(|答え| が |x| の約 2^-40 倍より小さい)ときだけ、これが ulp で見て目立つ。
// 基準はその4倍を足す。TAN は COS が 0 に近いと、COS の絶対誤差が |TAN| 倍に効く
const RAD_LIMIT = (base) => (w, [x]) => base + Math.abs(x) * 2 ** -70 / ulp(w);
const TAN_LIMIT = (base) => (w, [x]) => base + Math.abs(x) * 2 ** -70 / ulp(w) + Math.abs(x) * Math.abs(w) * 2 ** -38;
const ITEMS = [
  { name: 'SQR', run: unary(S.FSQR), gen: (r) => [r.log(-126, 126)], ref: Math.sqrt, limit: 0.5 },
  { name: 'EXP', run: unary(S.FEXP), gen: (r) => [r.uni(-88, 88)], ref: Math.exp, limit: 2 },
  { name: 'EXP small x', run: unary(S.FEXP), gen: (r) => [r.slog(-34, 0)], ref: Math.exp, limit: 2 },
  { name: 'LN', run: unary(S.FLN), gen: (r) => [r.log(-126, 126)], ref: Math.log, limit: 4 },
  { name: 'LN near 1', run: unary(S.FLN), gen: (r) => [q(1 + r.slog(-31, -1))], ref: Math.log, limit: 4 },
  { name: 'LOG', run: unary(afterPar('FN_LOG')), gen: (r) => [r.log(-126, 126)], ref: Math.log10, limit: 5 },
  { name: 'LOG near 1', run: unary(afterPar('FN_LOG')), gen: (r) => [q(1 + r.slog(-31, -1))], ref: Math.log10, limit: 5 },
  { name: 'SIN rad', run: unary(afterPar('FN_SIN')), gen: (r) => [r.uni(-10, 10)], ref: Math.sin, limit: RAD_LIMIT(3) },
  { name: 'COS rad', run: unary(afterPar('FN_COS')), gen: (r) => [r.uni(-10, 10)], ref: Math.cos, limit: RAD_LIMIT(3) },
  { name: 'TAN rad', run: unary(afterPar('FN_TAN')), gen: (r) => [r.uni(-10, 10)], ref: Math.tan, limit: TAN_LIMIT(5) },
  { name: 'SIN rad small x', run: unary(afterPar('FN_SIN')), gen: (r) => [r.slog(-60, 0)], ref: Math.sin, limit: RAD_LIMIT(3) },
  // π/2 の倍数のすぐ近く(答えが 0 に近い。0.11.9 で直したところ)
  { name: 'SIN rad near k*pi', run: unary(afterPar('FN_SIN')), gen: (r) => [q(r.int(-20, 20) * Math.PI + r.slog(-30, -2))], ref: Math.sin, limit: RAD_LIMIT(3) },
  { name: 'COS rad near k*pi/2', run: unary(afterPar('FN_COS')), gen: (r) => [q((2 * r.int(-20, 20) + 1) * Math.PI / 2 + r.slog(-30, -2))], ref: Math.cos, limit: RAD_LIMIT(3) },
  { name: 'TAN rad near k*pi/2', run: unary(afterPar('FN_TAN')), gen: (r) => [q(r.int(-40, 40) * Math.PI / 2 + r.slog(-30, -2))], ref: Math.tan, limit: TAN_LIMIT(5) },
  // π の倍数にいちばん近い数とその前後(k は 2^23 まで。x は約 2,600 万まで、q は 2^24 未満)。
  // 答えが引数に比べてとても 0 に近い(D19-01)
  { name: 'SIN rad nearest k*pi', run: unary(afterPar('FN_SIN')), gen: (r) => { const x = q(r.int(1, 2 ** 23) * Math.PI); return [x + r.int(-2, 2) * ulp(x)]; }, ref: Math.sin, limit: RAD_LIMIT(3) },
  { name: 'COS rad nearest (k+1/2)*pi', run: unary(afterPar('FN_COS')), gen: (r) => { const x = q((r.int(1, 2 ** 23) + 0.5) * Math.PI); return [x + r.int(-2, 2) * ulp(x)]; }, ref: Math.cos, limit: RAD_LIMIT(3) },
  // 2^24(約 1,700 万)までは π/2 を引く計算が正確なので、相対誤差も小さい
  { name: 'SIN rad to 2^24', run: unary(afterPar('FN_SIN')), gen: (r) => [r.slog(3, 24)], ref: Math.sin, limit: RAD_LIMIT(3) },
  { name: 'COS rad to 2^24', run: unary(afterPar('FN_COS')), gen: (r) => [r.slog(3, 24)], ref: Math.cos, limit: RAD_LIMIT(3) },
  // それより大きいと、説明書のとおり絶対誤差がおよそ 1E-9 以下
  { name: 'SIN rad to 6.7E9 (abs)', run: unary(afterPar('FN_SIN')), gen: (r) => [r.slog(24, 32.6)], ref: Math.sin, abs: 1e-9 },
  { name: 'COS rad to 6.7E9 (abs)', run: unary(afterPar('FN_COS')), gen: (r) => [r.slog(24, 32.6)], ref: Math.cos, abs: 1e-9 },
  { name: 'ATN', run: unary(afterPar('FN_ATN')), gen: (r) => [r.slog(-60, 60)], ref: Math.atan, limit: 2 },
  { name: 'SIN deg', run: unary(afterPar('FN_SIN'), 1), gen: (r) => [r.uni(-720, 720)], ref: sinDeg, limit: 3 },
  { name: 'COS deg', run: unary(afterPar('FN_COS'), 1), gen: (r) => [r.uni(-720, 720)], ref: cosDeg, limit: 3 },
  { name: 'TAN deg', run: unary(afterPar('FN_TAN'), 1), gen: (r) => [r.uni(-720, 720)], ref: tanDeg, limit: 5 },
  { name: 'SIN deg near k*90', run: unary(afterPar('FN_SIN'), 1), gen: (r) => [q(90 * r.int(-8, 8) + r.slog(-20, 0))], ref: sinDeg, limit: 3 },
  { name: 'COS deg near k*90', run: unary(afterPar('FN_COS'), 1), gen: (r) => [q(90 * r.int(-8, 8) + r.slog(-20, 0))], ref: cosDeg, limit: 3 },
  { name: 'TAN deg near k*90', run: unary(afterPar('FN_TAN'), 1), gen: (r) => [q(90 * r.int(-8, 8) + r.slog(-20, 0))], ref: tanDeg, limit: 5 },
  { name: 'SIN deg to 2.4E10', run: unary(afterPar('FN_SIN'), 1), gen: (r) => [r.slog(10, 34.4)], ref: sinDeg, limit: 3 },
  { name: 'ATN deg', run: unary(afterPar('FN_ATN'), 1), gen: (r) => [r.slog(-60, 60)], ref: (x) => Math.atan(x) / D, limit: 6 },   // ラジアンの答え(2ビット)に 180/π をかけるので、丸めが2回増える
  // べき乗。EXP(y × LN(x)) で計算するときは、答えが大きい(小さい)ほど誤差が増える:
  // 許す誤差は 4 + POW_K × |LN(答え)|
  { name: 'POW x^y (y not integer)', run: pow, gen: (r) => [r.log(-20, 20), q(r.uni(-40, 40) + 0.5 * r.next())], ref: (x, y) => x ** y, limit: (w) => 4 + POW_K * Math.abs(Math.log(w)) },
  { name: 'POW x^n (|n| <= 32)', run: pow, gen: (r) => { const n = r.int(-32, 32); return [q((r.next() < 0.3 ? -1 : 1) * 2 ** ((r.next() - 0.5) * 2 * Math.min(60, 120 / Math.max(1, Math.abs(n))))), n]; }, ref: (x, n) => x ** n, limit: (w, [, n]) => MUL_LIMIT(n) },
  // 底が 1 に近い小数で、指数が大きい整数(0.11.9 で直したところ)
  { name: 'POW x^n (x near 1, |n| > 32)', run: pow, gen: (r) => { const x = q((r.next() < 0.3 ? -1 : 1) * (1 + r.slog(-24, -3))); const n = r.int(33, 32767) * (r.next() < 0.5 ? -1 : 1); return [x, n]; }, ref: (x, n) => x ** n, limit: (w) => 4 + POW_K * Math.abs(Math.log(Math.abs(w))) },
  // 答えが 2^32 未満の整数になる整数乗は、途中もすべて正確なので、ちょうど
  { name: 'POW integer^n exact', run: pow, gen: (r) => { const x = r.int(2, 1000) * (r.next() < 0.3 ? -1 : 1); return [x, r.int(0, Math.floor(31.99 / Math.log2(Math.abs(x))))]; }, ref: (x, n) => x ** n, limit: 0 },
  // 底が整数なら、指数が大きくてもかけ算
  { name: 'POW integer^n', run: pow, gen: (r) => { const x = r.int(2, 1000) * (r.next() < 0.3 ? -1 : 1); const lim = Math.floor(125 / Math.log2(Math.abs(x))); return [x, r.int(-lim, lim)]; }, ref: (x, n) => x ** n, limit: (w, [, n]) => MUL_LIMIT(n) },
];
const POW_K = 5;
// かけ算をくり返すとき: 2乗するたびに、それまでの相対誤差が2倍になり、新しい丸めが足される。
// 合わせると、x^n の相対誤差はおよそ |n| 回分の丸め(半ビット)まで。ulp は答えの仮数によって
// 相対で2倍違うので |n| ビット。指数が負で x^|n| があふれそうなときは、先に 1/x にしてからかけるので、
// 1/x の丸めがさらに |n| 倍に効く。合わせて 2 + 2|n| ビットまでを許す
const MUL_LIMIT = (n) => 2 + 2 * Math.abs(n);

// 誤差の分布の区切り(ulp)
const BINS = [0.5, 1, 2, 3, 4, 8, 16, 64, 256, Infinity];
const binName = (i) => (BINS[i] === Infinity ? `>${BINS[i - 1]}` : `<=${BINS[i]}`);

console.log(`math functions (seed ${SEED}, ${COUNT} each)`);
for (const it of ITEMS) {
  if (ONLY && !it.name.includes(ONLY)) continue;
  const r = rng(`${SEED}:${it.name}`);
  const hist = new Array(BINS.length).fill(0);
  let worst = -1, worstAt = null, bad = 0, firstBad = '', done = 0;
  for (let i = 0; i < COUNT; i++) {
    const a = it.gen(r);
    const want = it.ref(...a);
    if (!Number.isFinite(want) || !inRange(want)) continue;
    const got = it.run(...a);
    done++;
    let e, lim;
    if (typeof got === 'object') { e = Infinity; lim = 0; }
    else if (it.abs) { e = Math.abs(got - want); lim = it.abs; }
    else { e = errUlp(got, want); lim = typeof it.limit === 'function' ? it.limit(want, a) : it.limit; }
    if (!it.abs) hist[BINS.findIndex((b) => e <= b)]++;
    const score = it.abs ? e : e / Math.max(lim, 1e-9);
    if (score > worst) { worst = score; worstAt = { a, got, want, e, lim }; }
    if (!(e <= lim * (1 + 1e-9))) {
      if (!bad) firstBad = `(${a.join(', ')}): got ${JSON.stringify(got)} want ${want} err ${e} limit ${lim}`;
      bad++;
    }
  }
  check(`${it.name} (${done})`, bad === 0, `${bad} over the limit. first: ${firstBad}`);
  if (REPORT && worstAt) {
    const w = worstAt;
    const unit = it.abs ? '' : ' ulp';
    console.log(`        worst (${w.a.join(', ')}): err ${w.e.toPrecision(3)}${unit} / limit ${+w.lim.toPrecision(3)}${unit}`);
    if (!it.abs) console.log(`        ${hist.map((n, i) => (n ? `${binName(i)}: ${n}` : '')).filter(Boolean).join('  ')}`);
  }
}

// ---- VAL(数の読み取り) ----
// 10桁までの数字と指数。誤差は 1 ulp まで(10桁なら 1.5)、9桁までの整数はちょうど
if (!ONLY || 'VAL'.includes(ONLY)) {
  console.log('VAL');
  const r = rng(`${SEED}:VAL`);
  let bad = 0, first = '', worst = 0, n = 0, badInt = 0, firstInt = '';
  for (let i = 0; i < COUNT * 2; i++) {
    const nd = r.int(1, 10);
    let d = '';
    for (let k = 0; k < nd; k++) d += r.int(0, 9);
    const pt = r.int(0, nd);
    let s = (r.chance(0.3) ? '-' : '') + d.slice(0, pt) + (pt < nd ? '.' + d.slice(pt) : '');
    if (s === '' || s === '-') s += '0';
    if (r.chance(0.6)) s += 'E' + r.int(-40, 40);
    const want = Number(s);
    if (!inRange(want)) continue;
    const got = val(s);
    n++;
    const e = typeof got === 'object' ? Infinity : errUlp(got, want);
    worst = Math.max(worst, e);
    // 9桁までは1ビット以内。10桁目は、取り込むときに32ビットを超えて丸めが1回増えるので 1.5 ビット
    if (!(e <= (nd <= 9 ? 1 : 1.5))) { if (!bad) first = `${s}: got ${JSON.stringify(got)} want ${want}`; bad++; }
  }
  check(`VAL error <= 1 ulp (10 digits: 1.5) (${n})`, bad === 0, `${bad} bad. first: ${first}`);
  for (let i = 0; i < COUNT; i++) {
    const v = r.int(-999999999, 999999999);
    const got = val(String(v));
    if (got !== v) { if (!badInt) firstInt = `${v}: got ${JSON.stringify(got)}`; badInt++; }
  }
  check(`VAL of integers up to 9 digits is exact (${COUNT})`, badInt === 0, `${badInt} bad. first: ${firstInt}`);
  if (REPORT) console.log(`        worst ${worst.toPrecision(3)} ulp`);
}

// ---- STR$(数の表示) ----
// 正しく9桁に丸めた表示か、最後の桁が1つずれた表示まで。整数(9桁まで)はちょうど
// ROM と同じ形で書く: digits は9桁の数字(先頭は0でない)、e10 は先頭の桁の10の指数
function fmt(neg, digits, e10) {
  const d = digits.replace(/0+$/, '') || '0';
  const E = e10 + 1;                      // 小数点の位置
  let body;
  if (E >= 1 && E <= 9) body = d.length <= E ? d + '0'.repeat(E - d.length) : d.slice(0, E) + '.' + d.slice(E);
  else if (E === 0) body = '.' + d;
  else if (E === -1) body = '.0' + d;
  else {
    const x = E - 1;
    body = d[0] + (d.length > 1 ? '.' + d.slice(1) : '') + 'E' + (x < 0 ? '-' : '+') + String(Math.abs(x)).padStart(2, '0');
  }
  return (neg ? '-' : ' ') + body;
}
// 正しい表示と、最後の桁が ±1 の表示
function strCandidates(v) {
  if (v === 0) return [' 0'];
  const [mant, ex] = Math.abs(v).toExponential(8).split('e');
  const D9 = BigInt(mant.replace('.', ''));
  const e10 = Number(ex);
  const out = [];
  for (const dd of [0n, -1n, 1n]) {
    let x = D9 + dd, e = e10;
    if (x === 1000000000n) { x = 100000000n; e++; }
    if (x === 99999999n) { x = 999999999n; e--; }
    out.push(fmt(v < 0, String(x), e));
  }
  return out;
}
if (!ONLY || 'STR$'.includes(ONLY)) {
  console.log('STR$');
  const r = rng(`${SEED}:STR$`);
  let exact = 0, off1 = 0, bad = 0, first = '', n = 0;
  for (let i = 0; i < COUNT * 2; i++) {
    const v = r.chance(0.5) ? r.slog(-126, 126) : q(Number((r.chance(0.5) ? '-' : '') + r.int(1, 999999999) + 'E' + r.int(-46, 29)));
    if (!inRange(v)) continue;
    const got = str(v);
    const c = strCandidates(v);
    n++;
    if (got === c[0]) exact++;
    else if (got === c[1] || got === c[2]) off1++;
    else { if (!bad) first = `${v}: got "${got}" want "${c[0]}"`; bad++; }
  }
  check(`STR$ is correct or 1 off in the last digit (${n})`, bad === 0, `${bad} bad. first: ${first}`);
  let badInt = 0, firstInt = '';
  for (let i = 0; i < COUNT; i++) {
    const v = r.int(-999999999, 999999999);
    const got = str(v);
    const want = (v < 0 ? '-' : ' ') + String(Math.abs(v));
    if (got !== want) { if (!badInt) firstInt = `${v}: got "${got}"`; badInt++; }
  }
  check(`STR$ of integers up to 9 digits is exact (${COUNT})`, badInt === 0, `${badInt} bad. first: ${firstInt}`);
  if (REPORT) console.log(`        exact ${exact}, last digit 1 off ${off1}`);
}

if (!ONLY) {
  // ---- 決まった値 ----
  console.log('exact values');
  const sin = unary(afterPar('FN_SIN')), cos = unary(afterPar('FN_COS')), tan = unary(afterPar('FN_TAN'));
  const sind = unary(afterPar('FN_SIN'), 1), cosd = unary(afterPar('FN_COS'), 1), tand = unary(afterPar('FN_TAN'), 1);
  const atnd = unary(afterPar('FN_ATN'), 1);
  const EXACT = [
    ['SQR(0)', unary(S.FSQR)(0), 0], ['SQR(1)', unary(S.FSQR)(1), 1], ['SQR(4)', unary(S.FSQR)(4), 2],
    ['SQR(1E8)', unary(S.FSQR)(1e8), 1e4], ['SQR(.25)', unary(S.FSQR)(0.25), 0.5],
    ['EXP(0)', unary(S.FEXP)(0), 1], ['LN(1)', unary(S.FLN)(1), 0], ['LOG(1)', unary(afterPar('FN_LOG'))(1), 0],
    ['SIN(0)', sin(0), 0], ['COS(0)', cos(0), 1], ['TAN(0)', tan(0), 0],
    ['SIN(90) deg', sind(90), 1], ['SIN(180) deg', sind(180), 0], ['SIN(-90) deg', sind(-90), -1],
    ['COS(90) deg', cosd(90), 0], ['COS(180) deg', cosd(180), -1], ['COS(-360) deg', cosd(-360), 1],
    ['TAN(180) deg', tand(180), 0], ['COS(0) deg', cosd(0), 1],
    ['SIN(3600090) deg', sind(3600090), 1],
    ['2^10', pow(2, 10), 1024], ['(-2)^3', pow(-2, 3), -8], ['2^-3', pow(2, -3), 0.125],
    ['3^20', pow(3, 20), 3486784401], ['10^9', pow(10, 9), 1e9], ['(-3)^-2', pow(-3, -2), q(1 / 9)],
    ['2^100', pow(2, 100), 2 ** 100], ['.5^120', pow(0.5, 120), 2 ** -120], ['(-2)^99', pow(-2, 99), -(2 ** 99)],
    ['1^30000', pow(1, 30000), 1], ['(-1)^30001', pow(-1, 30001), -1], ['(-1)^32767', pow(-1, 32767), -1], ['0^5', pow(0, 5), 0], ['7^0', pow(7, 0), 1],
    // 底が整数なら、指数が32を超えても最も近い値(EXP と LN だと 10^35 が 1.00000002E+35 になる)
    ['10^35', pow(10, 35), q(1e35)], ['3^40', pow(3, 40), q(3 ** 40)]
  ];
  for (const [name, got, want] of EXACT) check(`${name} = ${want}`, got === want, `got ${JSON.stringify(got)}`);
  // 度の ATN は ×180/π があるので、ちょうどではなく 1 ulp まで
  check('ATN(1) deg = 45 (1 ulp)', errUlp(atnd(1), 45) <= 1, `got ${atnd(1)}`);
  // 底が負で指数が32を超える奇数・偶数(EXP と LN で計算して符号を付ける)
  {
    const a = pow(q(-1.0001), 33), b = pow(q(-1.0001), 34), c = pow(q(-1.0001), -10001);
    check('(-1.0001)^33 is negative', a < 0 && errUlp(a, q(-1.0001) ** 33) <= 4, `got ${a}`);
    check('(-1.0001)^34 is positive', b > 0 && errUlp(b, q(-1.0001) ** 34) <= 4, `got ${b}`);
    check('(-1.0001)^-10001 is negative', c < 0 && errUlp(c, q(-1.0001) ** -10001) <= 4, `got ${c}`);
  }

  // レビュー(D19-01)の例: 正確に表せる引数で、答えが引数に比べてとても 0 に近い。
  // 0.11.9 は SIN(680232721/2048) が -3.59881236E-10(正しくは -3.59863537E-10)だった
  for (const x of [680232721 / 2048, 2737052.9091796875]) {
    const got = sin(x), want = Math.sin(x), lim = RAD_LIMIT(3)(want, [x]);
    check(`SIN(${x}) rad (D19-01)`, q(x) === x && errUlp(got, want) <= lim, `got ${got} want ${want} err ${errUlp(got, want)} limit ${lim}`);
  }
  // TAN も同じ残る誤差を引き継ぐ(D20-01。説明書だけの修正)
  {
    const x = 680232721 / 2048, got = tan(x), want = Math.tan(x), lim = TAN_LIMIT(5)(want, [x]);
    check(`TAN(${x}) rad (D20-01)`, errUlp(got, want) <= lim, `got ${got} want ${want} err ${errUlp(got, want)} limit ${lim}`);
  }

  // fsin の「|r| が π/4 を超えたら π/2 を足し引きする」ところ。ふつうの引数では r > π/4 にならない
  // (q を四捨五入で求めるため)ので、r と象限を置いて直接呼ぶ。答えは sin(r + 象限 × π/2)
  for (const [rr, quad] of [[1.2, 0], [-1.2, 0], [2.0, 1], [-2.5, 3], [0.7, 2]]) {
    const got = call(S.FSN_FIX, () => { ram[S.SIN_Q] = quad; setReg(S.FAC_E, q(rr)); });
    const want = Math.sin(q(rr) + quad * Math.PI / 2);
    check(`fsn_fix r=${rr} quadrant ${quad}`, errUlp(got, want) <= 4, `got ${JSON.stringify(got)} want ${want}`);
  }

  // ---- エラーになる境目 ----
  console.log('errors');
  const isErr = (got, en) => typeof got === 'object' && got.error === en;
  const ERRS = [
    ['SQR(-1)', unary(S.FSQR)(-1), S.EN_FC],
    ['LN(0)', unary(S.FLN)(0), S.EN_FC], ['LN(-1)', unary(S.FLN)(-1), S.EN_FC], ['LOG(-5)', unary(afterPar('FN_LOG'))(-5), S.EN_FC],
    ['EXP(88.1)', unary(S.FEXP)(88.1), S.EN_OV], ['EXP(89)', unary(S.FEXP)(89), S.EN_OV], ['EXP(1000)', unary(S.FEXP)(1000), S.EN_OV],
    ['TAN(90) deg', tand(90), S.EN_DIV0], ['TAN(-270) deg', tand(-270), S.EN_DIV0],
    ['SIN(7E9) rad', sin(7e9), S.EN_FC], ['COS(-7E9) rad', cos(-7e9), S.EN_FC], ['SIN(2.5E10) deg', sind(2.5e10), S.EN_FC],
    ['0^-1', pow(0, -1), S.EN_DIV0], ['(-2)^.5', pow(-2, 0.5), S.EN_FC], ['(-1.5)^40000', pow(-1.5, 40000), S.EN_FC],
    ['(-1)^32768', pow(-1, 32768), S.EN_FC],        // 指数が 32767 を超えると EXP と LN になるので、負の底はエラー(D19-02)
    ['2^128', pow(2, 128), S.EN_OV], ['10^39', pow(10, 39), S.EN_OV], ['1.0001^1000000', pow(q(1.0001), 1e6), S.EN_OV],
    ['1.01^30000', pow(q(1.01), 30000), S.EN_OV],
    ['5E9^33', pow(5e9, 33), S.EN_OV],              // 底が 2^32 以上の整数(かけ算)
  ];
  for (const [name, got, en] of ERRS) check(`${name} is error ${en}`, isErr(got, en), `got ${JSON.stringify(got)}`);
  const ZERO = [
    ['EXP(-89)', unary(S.FEXP)(-89)], ['EXP(-1000)', unary(S.FEXP)(-1000)], ['2^-130', pow(2, -130)],
    ['.9999^1000000', pow(q(0.9999), 1e6)], ['.99^30000', pow(q(0.99), 30000)], ['5E9^-33', pow(5e9, -33)],
  ];
  for (const [name, got] of ZERO) check(`${name} = 0`, got === 0, `got ${JSON.stringify(got)}`);
  check('SIN(6.6E9) rad works', typeof sin(6.6e9) === 'number');
  check('EXP(88) works', typeof unary(S.FEXP)(88) === 'number');
  check('2^126 works', pow(2, 126) === 2 ** 126);

  // ---- BASIC で表示したとき ----
  console.log('display');
  const b = bootBasic();
  const SHOW = [
    ['PRINT SIN(PI)', ' 1.2154201E-10'],            // 丸めた π に対する正しい値(0.11.8 では 0)
    ['PRINT SIN(3*PI)', '-1.49801912E-09'],
    ['PRINT COS(PI/2)', ' 6.07710051E-11'],         // 正しい値。0.11.8 では 0、0.11.9 では 6.0771005E-11
    ['PRINT COS(0)=1;SIN(PI/2)=1', '-1  0'],        // COS(0) はちょうど 1(0.11.8 では 1 より 1ビット小さかった)
    ['PRINT SIN(3.14138865)', ' 2.04003536E-04'],     // 0.11.8 では 2.04003415E-04
    ['PRINT SIN(680232721/2048)', '-3.59863607E-10'],  // 正しくは -3.59863537E-10。0.11.9 では -3.59881236E-10
    ['PRINT SIN(2737052.9091796875)', ' 1.65293847E-09'], // 正しくは 1.65293905E-09。0.11.9 では 1.65279346E-09
    ['PRINT TAN(680232721/2048)', ' 3.59863607E-10'],   // 正しくは 3.59863537E-10(D20-01)
    ['PRINT COS(PI)', '-1'],
    ['PRINT 1.0001^10000', ' 2.71814131'],          // 0.11.8 では 2.71813883
    ['PRINT 1.001^1000', ' 2.71692437'],            // 正しく丸めると …438(最後の桁の1つのずれは基準の内)。0.11.8 では …424
    ['PRINT 10^35', ' 1E+35'],
    ['PRINT 2^40', ' 1.09951163E+12'],
    ['PRINT (-1.0001)^10001', '-2.71841312'],       // 0.11.8 では -2.71841064
    ['DEG:PRINT SIN(30);COS(60);TAN(45)', ' .5  .5  1'],
    ['DEG:PRINT SIN(90)=1;COS(180)=-1;SIN(-450)', '-1 -1 -1'],
  ];
  for (const [line, want] of SHOW) {
    // 打った行のエコーと答えはつながって集まる(test/basic_harness.js)
    const out = b.run(line);
    const got = out.startsWith(line) ? out.slice(line.length).split('\n')[0].trimEnd() : out;
    check(`${line} -> "${want}"`, got === want, `got "${got}"`);
  }
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
