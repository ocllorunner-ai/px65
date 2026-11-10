// PX-65用の小さな65C02アセンブラ(Node.jsだけで動く)
//
//   node tools/asm.js <ソース.s> -o <出力.bin> [--range C000:FFFF] [-l <リスト.lst>]
//
// --range を指定すると、その範囲をちょうど切り出して出力する(未使用の場所は $FF)。
// 省略すると、書き込んだ最小アドレスから最大アドレスまでを出力する。
//
// 書式:
//   label:                ラベル
//   NAME = 式             定数
//   .org 式               配置アドレス
//   .byte 式, "文字列"    バイト列(.text も同じ)
//   .word 式, ...         16ビット値(リトルエンディアン)
//   .fill 個数[, 値]      同じ値を並べる
//   .include "ファイル"   別のソースをその場所に読み込む(パスはこのファイルからの相対)
//   ; コメント
// 式: $FF %1010 255 'A' * (現在のアドレス)、+ - * / & | ^ << >>、単項 - ~ <(下位) >(上位)、( )
// アドレッシング: #即値  zp  abs  zp,X  abs,Y  (zp,X)  (zp),Y  (zp)  (abs)  (abs,X)  A
// RMB/SMB/BBR/BBS はビット番号付きで書く: RMB3 $10 / BBS7 $10, label

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OPCODES } from '../src/cpu65c02.js';

// ニーモニック -> { アドレッシング: オペコード }
const INSTR = {};
for (let op = 0; op < 256; op++) {
  const e = OPCODES[op];
  if (e.mode === 'n1' || e.mode === 'n2' || e.mode === 'n3') continue;
  const bitOps = ['RMB', 'SMB', 'BBR', 'BBS'];
  const mnem = bitOps.includes(e.name) ? e.name + ((op >> 4) & 7) : e.name;
  (INSTR[mnem] ??= {})[e.mode] = op;
}

const SIZE = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, izx: 2, izy: 2, izp: 2, rel: 2,
  abs: 3, abx: 3, aby: 3, ind: 3, aix: 3, zpr: 3 };

class AsmError extends Error {}

// ---- 式の評価 ----
// 未定義のシンボルがあれば undefined を返す(パス1用)
function evaluate(text, symbols, pc) {
  const src = text.trim();
  let i = 0;
  let unknown = false;
  const ws = () => { while (src[i] === ' ' || src[i] === '\t') i++; };

  function primary() {
    ws();
    const c = src[i];
    if (c === '(') {
      i++;
      const v = binary(0);
      ws();
      if (src[i] !== ')') throw new AsmError(`')' がありません: ${src}`);
      i++;
      return v;
    }
    if (c === '-') { i++; return -primary(); }
    if (c === '~') { i++; return ~primary(); }
    if (c === '<') { i++; return primary() & 0xff; }
    if (c === '>') { i++; return (primary() >> 8) & 0xff; }
    if (c === '*') { i++; return pc; }
    if (c === '$') {
      const m = /^[0-9A-Fa-f]+/.exec(src.slice(i + 1));
      if (!m) throw new AsmError(`16進数が不正です: ${src}`);
      i += 1 + m[0].length;
      return parseInt(m[0], 16);
    }
    if (c === '%') {
      const m = /^[01]+/.exec(src.slice(i + 1));
      if (!m) throw new AsmError(`2進数が不正です: ${src}`);
      i += 1 + m[0].length;
      return parseInt(m[0], 2);
    }
    if (c === "'") {
      if (src[i + 2] !== "'") throw new AsmError(`文字定数が不正です: ${src}`);
      const v = src.charCodeAt(i + 1);
      i += 3;
      return v;
    }
    let m = /^[0-9]+/.exec(src.slice(i));
    if (m) { i += m[0].length; return parseInt(m[0], 10); }
    m = /^[A-Za-z_.@][\w.@]*/.exec(src.slice(i));
    if (m) {
      i += m[0].length;
      const key = m[0].toUpperCase();
      if (key in symbols) return symbols[key];
      unknown = true;
      return 0;
    }
    throw new AsmError(`式が不正です: ${src}`);
  }

  const PREC = [['|'], ['^'], ['&'], ['<<', '>>'], ['+', '-'], ['*', '/']];
  function binary(level) {
    if (level === PREC.length) return primary();
    let v = binary(level + 1);
    for (;;) {
      ws();
      const op = PREC[level].find((o) => src.startsWith(o, i));
      if (!op) return v;
      i += op.length;
      const r = binary(level + 1);
      switch (op) {
        case '|': v |= r; break;
        case '^': v ^= r; break;
        case '&': v &= r; break;
        case '<<': v <<= r; break;
        case '>>': v >>= r; break;
        case '+': v += r; break;
        case '-': v -= r; break;
        case '*': v *= r; break;
        case '/': if (r === 0 && !unknown) throw new AsmError('0で割っています'); v = r ? Math.trunc(v / r) : 0; break;
      }
    }
  }

  const v = binary(0);
  ws();
  if (i !== src.length) throw new AsmError(`式の後ろに余分な文字があります: ${src}`);
  return unknown ? undefined : v;
}

// カンマで区切る(括弧と引用符の中は区切らない)
function splitArgs(text) {
  const out = [];
  let depth = 0, quote = null, cur = '';
  for (const c of text) {
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === ';') return line.slice(0, i);
  }
  return line;
}

// オペランドの形からアドレッシングの候補を決める
function classify(mnem, operand) {
  const modes = INSTR[mnem];
  const op = operand.trim();
  if (op === '') return { kind: modes.acc !== undefined ? 'acc' : 'imp' };
  if (/^a$/i.test(op) && modes.acc !== undefined) return { kind: 'acc' };
  if (op.startsWith('#')) return { kind: 'imm', expr: op.slice(1) };
  if (modes.zpr !== undefined) {
    const args = splitArgs(op);
    if (args.length !== 2) throw new AsmError(`${mnem} は「ゼロページ, 分岐先」の形で書きます`);
    return { kind: 'zpr', expr: args[0], expr2: args[1] };
  }
  let m = /^\((.*),\s*x\)$/i.exec(op);
  if (m) return { kind: 'indx', expr: m[1] };
  m = /^\((.*)\),\s*y$/i.exec(op);
  if (m) return { kind: 'izy', expr: m[1] };
  m = /^\((.*)\)$/.exec(op);
  if (m) return { kind: 'ind', expr: m[1] };
  m = /^(.*),\s*x$/i.exec(op);
  if (m) return { kind: 'x', expr: m[1] };
  m = /^(.*),\s*y$/i.exec(op);
  if (m) return { kind: 'y', expr: m[1] };
  return { kind: 'plain', expr: op };
}

// 候補と値から最終的なアドレッシングを選ぶ。value が undefined なら大きい方を選ぶ
function chooseMode(mnem, cls, value) {
  const modes = INSTR[mnem];
  const has = (m) => modes[m] !== undefined;
  const small = value !== undefined && value >= 0 && value < 0x100;
  const pick = (zp, abs) => {
    if (has(zp) && (small || !has(abs))) return zp;
    if (has(abs)) return abs;
    return null;
  };
  switch (cls.kind) {
    case 'imp': return has('imp') ? 'imp' : null;
    case 'acc': return 'acc';
    case 'imm': return has('imm') ? 'imm' : null;
    case 'zpr': return 'zpr';
    case 'indx': return has('izx') ? 'izx' : has('aix') ? 'aix' : null;
    case 'izy': return has('izy') ? 'izy' : null;
    case 'ind': return has('izp') ? 'izp' : has('ind') ? 'ind' : null;
    case 'x': return pick('zpx', 'abx');
    case 'y': return pick('zpy', 'aby');
    case 'plain': return has('rel') ? 'rel' : pick('zp', 'abs');
    default: return null;
  }
}

// ソースを行に分け、.include を展開する。各行は { raw, file, no }
function loadLines(source, fileName, depth = 0) {
  if (depth > 8) throw new AsmError(`${fileName}: .include が深すぎます`);
  const out = [];
  source.split(/\r?\n/).forEach((raw, i) => {
    const m = /^\s*\.include\s+"([^"]+)"\s*(;.*)?$/i.exec(raw);
    if (!m) { out.push({ raw, file: fileName, no: i + 1 }); return; }
    const path = join(dirname(fileName), m[1]);
    let text;
    try { text = readFileSync(path, 'utf8'); } catch {
      throw new AsmError(`${fileName}:${i + 1}: .include のファイルを読めません: ${m[1]}`);
    }
    out.push(...loadLines(text, path, depth + 1));
  });
  return out;
}

export function assemble(source, fileName = 'source') {
  const lines = loadLines(source, fileName);
  const symbols = {};
  const modeCache = new Map(); // 行番号 -> パス1で決めたアドレッシング
  let mem, written, listing, lineInfo;

  for (let pass = 1; pass <= 2; pass++) {
    let pc = 0;
    mem = new Uint8Array(0x10000).fill(0xff);
    written = new Uint8Array(0x10000);
    listing = [];
    lineInfo = [];
    const final = pass === 2;

    const value = (expr, lineNo) => {
      const v = evaluate(expr, symbols, pc);
      if (v === undefined && final) throw new AsmError(`未定義のシンボルがあります: ${expr}`);
      return v;
    };
    const emit = (bytes) => {
      for (const b of bytes) {
        if (final) {
          if (written[pc]) throw new AsmError(`$${pc.toString(16).toUpperCase()} に二重に書き込んでいます`);
          mem[pc] = b & 0xff;
          written[pc] = 1;
        }
        pc = (pc + 1) & 0xffff;
      }
    };
    const define = (name, v) => {
      const key = name.toUpperCase();
      if (pass === 1 && key in symbols) throw new AsmError(`シンボルが重複しています: ${name}`);
      symbols[key] = v;
    };

    for (let n = 0; n < lines.length; n++) {
      const { raw, file, no } = lines[n];
      let text = stripComment(raw).trim();
      const startPc = pc;
      let isCode = false;
      try {
        // 定数定義
        let m = /^([A-Za-z_.@][\w.@]*)\s*=\s*(.+)$/.exec(text);
        if (m) {
          const v = value(m[2], n);
          if (v !== undefined) define(m[1], v);
          else if (pass === 1) throw new AsmError(`定数は前で定義済みの値だけで書いてください: ${m[1]}`);
          continue;
        }
        // ラベル
        m = /^([A-Za-z_.@][\w.@]*):\s*(.*)$/.exec(text);
        if (m) {
          if (pass === 1) define(m[1], pc);
          text = m[2].trim();
        }
        if (text === '') continue;

        const [word, ...restParts] = text.split(/\s+/);
        const rest = text.slice(word.length).trim();
        const kw = word.toUpperCase();

        if (kw.startsWith('.')) {
          switch (kw) {
            case '.ORG': {
              const v = value(rest, n);
              if (v === undefined) throw new AsmError('.org の値は前で定義済みの値だけで書いてください');
              pc = v & 0xffff;
              break;
            }
            case '.BYTE': case '.TEXT': case '.DB':
              for (const arg of splitArgs(rest)) {
                if (arg.startsWith('"')) {
                  if (!arg.endsWith('"') || arg.length < 2) throw new AsmError(`文字列が閉じていません: ${arg}`);
                  emit([...arg.slice(1, -1)].map((ch) => ch.charCodeAt(0)));
                } else {
                  const v = value(arg, n) ?? 0;
                  if (final && (v < -128 || v > 255)) throw new AsmError(`1バイトに収まりません: ${arg}`);
                  emit([v]);
                }
              }
              break;
            case '.WORD': case '.DW':
              for (const arg of splitArgs(rest)) {
                const v = value(arg, n) ?? 0;
                emit([v & 0xff, (v >> 8) & 0xff]);
              }
              break;
            case '.FILL': {
              const [countExpr, valExpr = '$FF'] = splitArgs(rest);
              const count = value(countExpr, n);
              if (count === undefined) throw new AsmError('.fill の個数は前で定義済みの値だけで書いてください');
              const v = value(valExpr, n) ?? 0;
              emit(new Array(count).fill(v));
              break;
            }
            default:
              throw new AsmError(`未知の疑似命令です: ${word}`);
          }
        } else {
          const mnem = kw;
          if (!INSTR[mnem]) throw new AsmError(`未知の命令です: ${word}`);
          const cls = classify(mnem, rest);
          let v = cls.expr !== undefined ? value(cls.expr, n) : undefined;

          let mode = modeCache.get(n);
          if (pass === 1 || mode === undefined) {
            mode = chooseMode(mnem, cls, v);
            if (mode === null) throw new AsmError(`${mnem} はこのアドレッシングで使えません: ${rest}`);
            modeCache.set(n, mode);
          }
          const opcode = INSTR[mnem][mode];
          const size = SIZE[mode];

          isCode = true;
          if (!final) { emit(new Array(size).fill(0)); continue; }

          const bytes = [opcode];
          const branchOffset = (target, nextPc) => {
            const off = target - nextPc;
            if (off < -128 || off > 127) throw new AsmError(`分岐先が遠すぎます(${off}バイト)`);
            return off & 0xff;
          };
          switch (mode) {
            case 'imp': case 'acc': break;
            case 'imm': case 'zp': case 'zpx': case 'zpy': case 'izx': case 'izy': case 'izp':
              if (v < -128 || v > 255) throw new AsmError(`1バイトに収まりません: ${cls.expr}`);
              bytes.push(v & 0xff);
              break;
            case 'rel':
              bytes.push(branchOffset(v, (pc + 2) & 0xffff));
              break;
            case 'zpr': {
              if (v < 0 || v > 255) throw new AsmError(`ゼロページのアドレスではありません: ${cls.expr}`);
              const target = value(cls.expr2, n);
              bytes.push(v & 0xff, branchOffset(target, (pc + 3) & 0xffff));
              break;
            }
            default:
              bytes.push(v & 0xff, (v >> 8) & 0xff);
          }
          emit(bytes);
        }
      } catch (err) {
        if (err instanceof AsmError) throw new AsmError(`${file}:${no}: ${err.message}\n    ${raw.trim()}`);
        throw err;
      } finally {
        if (final) {
          const len = (pc - startPc) & 0xffff;
          const hexBytes = [];
          for (let k = 0; k < Math.min(len, 4); k++) hexBytes.push(mem[(startPc + k) & 0xffff].toString(16).toUpperCase().padStart(2, '0'));
          const addr = len ? startPc.toString(16).toUpperCase().padStart(4, '0') : '    ';
          listing.push(`${addr}  ${hexBytes.join(' ').padEnd(12)}${len > 4 ? '+' : ' '} ${raw}`);
          if (len) lineInfo.push({ addr: startPc, len, file, no, code: isCode });
        }
      }
    }
  }

  let lo = 0x10000, hi = -1;
  for (let a = 0; a < 0x10000; a++) if (written[a]) { if (a < lo) lo = a; hi = a; }
  // lines: 機械語やデータを出した行ごとの { addr, len, file, no, code }(code は命令の行なら true)。
  // カバレッジと実行時の見張り(test/watch.js)が使う
  return { mem, written, lo, hi, symbols, listing: listing.join('\n'), lines: lineInfo };
}

// ---- コマンドライン ----
function main(argv) {
  let input, output, listingPath, range;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-o') output = argv[++i];
    else if (argv[i] === '-l') listingPath = argv[++i];
    else if (argv[i] === '--range') range = argv[++i];
    else input = argv[i];
  }
  if (!input || !output) {
    console.error('usage: node tools/asm.js <source.s> -o <out.bin> [--range C000:FFFF] [-l <out.lst>]');
    process.exit(2);
  }
  try {
    const r = assemble(readFileSync(input, 'utf8'), input);
    let start = r.lo, end = r.hi;
    if (range) {
      const [s, e] = range.split(':').map((h) => parseInt(h, 16));
      for (let a = 0; a < 0x10000; a++) {
        if (r.written[a] && (a < s || a > e)) throw new AsmError(`$${a.toString(16).toUpperCase()} が --range の外にあります`);
      }
      start = s; end = e;
    }
    if (end < start) throw new AsmError('出力するデータがありません');
    writeFileSync(output, r.mem.subarray(start, end + 1));
    if (listingPath) writeFileSync(listingPath, r.listing + '\n');
    const hex = (v) => '$' + v.toString(16).toUpperCase().padStart(4, '0');
    console.log(`${output}: ${end - start + 1} bytes (${hex(start)}-${hex(end)})`);
  } catch (err) {
    if (err instanceof AsmError) { console.error(err.message); process.exit(1); }
    throw err;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
