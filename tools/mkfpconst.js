// BASIC の浮動小数点の定数を作る
//
//   node tools/mkfpconst.js            # rom/basic_const.s を書き出す
//
// 数の形式(5バイト):
//   バイト0     指数。0 なら値は 0。それ以外は 値 = 0.1mmm…(2進) × 2^(指数-128)
//   バイト1-4   仮数(上位から)。仮数の最上位ビットはいつも1なので、そこに符号を入れる(1なら負)
//
// encodeFloat / decodeFloat はテストからも使う。

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// JavaScript の数を5バイトにする(最も近い値に丸める)
export function encodeFloat(v) {
  if (v === 0) return [0, 0, 0, 0, 0];
  const neg = v < 0;
  let a = Math.abs(v);
  let e = Math.floor(Math.log2(a)) + 1; // a = m × 2^e、m は [0.5, 1)
  let m = a / 2 ** e;
  if (m >= 1) { m /= 2; e++; }
  if (m < 0.5) { m *= 2; e--; }
  let mant = Math.round(m * 2 ** 32);
  if (mant >= 2 ** 32) { mant /= 2; e++; }
  const exp = e + 128;
  if (exp <= 0) return [0, 0, 0, 0, 0];
  if (exp > 255) throw new Error(`overflow: ${v}`);
  const b = [exp, (mant >>> 24) & 0xff, (mant >>> 16) & 0xff, (mant >>> 8) & 0xff, mant & 0xff];
  b[1] = (b[1] & 0x7f) | (neg ? 0x80 : 0);
  return b;
}

export function decodeFloat(b) {
  if (b[0] === 0) return 0;
  const mant = ((b[1] | 0x80) * 2 ** 24) + b[2] * 2 ** 16 + b[3] * 2 ** 8 + b[4];
  const v = (mant / 2 ** 32) * 2 ** (b[0] - 128);
  return b[1] & 0x80 ? -v : v;
}

const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));

// π/2 を、有効数字8ビットの4つと残りに分ける(SIN の引数を -π/4〜π/4 に直すときに使う)。
// 8ビットの部分は、24ビットまでの整数(引数が約2,600万まで)を掛けても誤差が出ない。
// 残りは32ビットに丸めるので、π/2 は合わせて約64ビットの精度になる(0.11.9 までは8ビット×3と残りで約56ビット)。
// double(53ビット)では足りないので、π の16進の展開から整数で計算する
function splitHalfPi() {
  const PI_HEX = '3243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89'; // π = 3.243F6A88…
  const scale = BigInt(4 * (PI_HEX.length - 1) + 1);                              // π/2 なので1ビット多く
  let rem = BigInt('0x' + PI_HEX);
  const toNum = (v) => Number(v) / 2 ** Number(scale);
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const keep = BigInt(rem.toString(2).length - 8);
    const chunk = (rem >> keep) << keep;
    parts.push(toNum(chunk));
    rem -= chunk;
  }
  parts.push(toNum(rem));
  return parts;
}
const HALF_PI_PARTS = splitHalfPi();

// 名前 -> 値
const CONSTANTS = [
  ['c_half', 0.5],
  ['c_one', 1],
  ['c_mone', -1],
  ['c_ten', 10],
  ['c_1e8', 1e8],
  ['c_1e9', 1e9],
  ['c_pi', Math.PI],
  ['c_halfpi', Math.PI / 2],
  ['c_2_pi', 2 / Math.PI],
  ['c_pio4', Math.PI / 4],              // SIN の引数を直した後の範囲
  ['c_pio2_1', HALF_PI_PARTS[0]],        // π/2 = c_pio2_1 + … + c_pio2_5
  ['c_pio2_2', HALF_PI_PARTS[1]],        // (1〜4 は有効数字8ビット)
  ['c_pio2_3', HALF_PI_PARTS[2]],
  ['c_pio2_4', HALF_PI_PARTS[3]],
  ['c_pio2_5', HALF_PI_PARTS[4]],
  ['c_ln2', Math.LN2],
  ['c_ln2hi', 0.693359375],              // ln2 の上位(少ないビットで表せる値)
  ['c_ln2lo', Math.LN2 - 0.693359375],   // 残り
  ['c_inv_ln2', 1 / Math.LN2],
  ['c_inv_ln10', 1 / Math.LN10],
  ['c_sqrthalf', Math.SQRT1_2],
  ['c_deg2rad', Math.PI / 180],
  ['c_360', 360],
  ['c_inv360', 1 / 360],
  ['c_90', 90],
  ['c_45', 45],
  ['c_rad2deg', 180 / Math.PI],
  ['c_tan15', Math.tan(Math.PI / 12)],
  ['c_sqrt3', Math.sqrt(3)],
  ['c_pi6', Math.PI / 6],
  ['c_89', 89],                          // EXP の大まかな範囲(細かい判定は指数で行う)
  ['c_32768', 32768],
  ['c_50', 50],
  // BEEP の待ちの回数 = 34786 / f - 6.29(1回14サイクル、ほかに約88サイクル、
  // タイマー割り込みが約2.6%。エミュレーターで測って決めた)
  ['c_beepk', 34786],
  ['c_beepofs', -6.29],
];

// 多項式(ホーナー法で、最高次の係数から並べる)。先頭のバイトは係数の数
const SERIES = [
  // sin(y)/y = 1 - y²/3! + y⁴/5! - …(y² の多項式)
  ['sin_poly', [-1 / fact(15), 1 / fact(13), -1 / fact(11), 1 / fact(9), -1 / fact(7), 1 / fact(5), -1 / fact(3), 1]],
  // e^r = 1 + r + r²/2! + …(r の多項式)
  ['exp_poly', [1 / fact(11), 1 / fact(10), 1 / fact(9), 1 / fact(8), 1 / fact(7), 1 / fact(6), 1 / fact(5),
    1 / fact(4), 1 / fact(3), 1 / fact(2), 1, 1]],
  // ln(m) = 2s(1 + s²/3 + s⁴/5 + …)、s = (m-1)/(m+1)(s² の多項式)
  ['ln_poly', [1 / 15, 1 / 13, 1 / 11, 1 / 9, 1 / 7, 1 / 5, 1 / 3, 1]],
  // atn(t)/t = 1 - t²/3 + t⁴/5 - …(t² の多項式、|t| <= tan 15°)
  ['atn_poly', [-1 / 19, 1 / 17, -1 / 15, 1 / 13, -1 / 11, 1 / 9, -1 / 7, 1 / 5, -1 / 3, 1]],
];

// 10進数の各桁を出すための 10^8 … 10^0(32ビット整数、上位から)
const POW10 = [1e8, 1e7, 1e6, 1e5, 1e4, 1e3, 100, 10, 1];

const hex = (v) => '$' + v.toString(16).toUpperCase().padStart(2, '0');

function generate() {
  const lines = ['; 浮動小数点の定数(tools/mkfpconst.js が生成。手で直さないこと)', ''];
  for (const [name, v] of CONSTANTS) {
    lines.push(`${name}:`.padEnd(14) + `.byte ${encodeFloat(v).map(hex).join(', ')}   ; ${v}`);
  }
  lines.push('');
  for (const [name, coefs] of SERIES) {
    lines.push(`${name}:`, `        .byte ${coefs.length}`);
    for (const c of coefs) lines.push(`        .byte ${encodeFloat(c).map(hex).join(', ')}   ; ${c}`);
  }
  lines.push('', '; 10^8 … 10^0(上位バイトから)', 'pow10_tab:');
  for (const p of POW10) {
    const b = [(p >>> 24) & 0xff, (p >>> 16) & 0xff, (p >>> 8) & 0xff, p & 0xff];
    lines.push(`        .byte ${b.map(hex).join(', ')}   ; ${p}`);
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(root, 'rom/basic_const.s'), generate());
  console.log('rom/basic_const.s written');
}
