// ランダムな入力で BASIC を試す(ファジング)
//
//   npm run fuzz                         # 種は時刻から。各種類 200 件
//   npm run fuzz -- --seed 123 --count 500
//   npm run fuzz -- --kind prog --count 50
//   npm run fuzz -- --seed 123 --case prog:17 --verbose   # 1件だけやり直して、打ったものと表示を全部出す
//   npm run fuzz -- --seed 1 --count 10 --repro-check     # 最初の3件を逆の順で動かし直して、同じになるか確かめる
//
// test/basic_harness.js で BASIC を動かすので、test/watch.js の見張り(メモリの記録の検査も)が付く。
// どの種類も、止まらないこと、見張りの違反がないこと、表示されたエラーが既知のものであることを調べる。
// 種類:
//   expr  ランダムな式を PRINT や代入で直接実行する(ときどき1文字を壊す)。
//         毎行の後で、番兵の行(1 REM SENTINEL)のバイトと Z$ が変わっていないかも調べる
//   prog  必ず終わるように作ったランダムなプログラム(メインとサブルーチンを分ける。GOTO と GOSUB は後ろの行へだけ、
//         サブルーチンは必ず RETURN まで実行する、FOR は回数が決まっている。makeProgram の説明を参照)。
//         毎回の RUN の後で、プログラムの全バイトが変わっていないかを調べる。
//         同じ出力になるかを調べる: もう一度 RUN、LIST の表示を打ち直して RUN(バイトも同じか)、
//         RENUM して RUN(エラーの行番号は対応させる)、SAVE・NEW・LOAD して RUN(バイトも同じか)。
//         画面(VRAM)は、2回目と打ち直した後を最初と、LOAD の後を RENUM の後と比べる
//         (行番号が画面に出ないなら、RENUM の後も最初と比べる)
//   edit  長さのばらばらな行の追加・置き換え・削除、DELETE、変数を作る、を続けて、
//         打った行がそのまま LIST に出るか、消した行が残っていないかを調べる
//   keys  ← → ↑ ↓ DEL を混ぜたでたらめなキーを、プロンプト、計算モード、EDIT の中で打つ
//   mon   モニターのコマンド(test/fuzz_mon.js)。E・F・M・A・L で書いたメモリ、H・S・C・B・R・D・W・L の表示を
//         JavaScript の写しと比べる。A は命令表から作った行のバイト、U は表示を A に打ち直すと同じバイトになるか。
//         G・T・P・B は、でたらめな機械語のプログラムを動かし、止まったときのレジスタとメモリを、
//         同じ CPU コアで動かした写しと比べる(test/fuzz_mon_run.js)
//   input INPUT にでたらめな答えを打つ(test/fuzz_input.js)。画面に出る文字の全部(? ?? ?REDO と、PRINT した値)を
//         写しと比べる
//   files でたらめなブロックのテープで FILES を打ち、ページ送りのキーを押す(test/fuzz_files.js)。一覧を写しと比べる
//
// 各件の前に必ず電源を入れ直して同じ準備をするので、一括でも --case でも同じ状態から始まる。
// 失敗したら、種類、件の番号、打った行、理由を表示する。--seed と --case で同じ件をやり直せる。

import { bootBasic } from './basic_harness.js';
import { takeViolations } from './watch.js';
import { pathToFileURL } from 'node:url';
import { caseMon as monCase } from './fuzz_mon.js';
import { caseInput as inputCase } from './fuzz_input.js';
import { caseFiles as filesCase } from './fuzz_files.js';

// ---- 引数 ----
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const SEED = Number(opt('seed', Date.now() % 1000000));
const COUNT = Number(opt('count', 200));
const KINDS = opt('kind', 'expr,prog,edit,keys,mon,input,files').split(',');
const ONE = opt('case', null);
const VERBOSE = args.includes('--verbose');
const REPRO = args.includes('--repro-check');   // 一括で動かした後、最初の3件を逆の順で動かし直して、打ったもの・表示の全部と最後のRAMが同じかを確かめる

// ---- 乱数(種から決まる) ----
function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
export function rng(seedText) {
  let a = hash(seedText);
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const r = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
  };
  return r;
}

const MAXLINE = 58;
const ERRORS = ['SN', 'OV', '/0', 'FC', 'UL', 'OM', 'TM', 'BS', 'DD', 'LS', 'NF', 'RG', 'OD', 'CN', 'ID', 'NT', 'TP', 'TF'];

// ---- 式を作る ----
const NUMVARS = ['A', 'B', 'C', 'X', 'Y', 'Z1'];
const STRVARS = ['A$', 'B$', 'S$'];
const FUNCS1 = ['ABS', 'SGN', 'INT', 'SQR', 'SIN', 'COS', 'TAN', 'ATN', 'EXP', 'LN', 'LOG'];
const BINOPS = ['+', '-', '*', '/', '^', '=', '<>', '<', '>', '<=', '>=', ' AND ', ' OR '];

function numLiteral(r) {
  switch (r.int(0, 7)) {
    case 0: return String(r.int(0, 10));
    case 1: return String(r.int(0, 70000));
    case 2: { // 小数
      const a = String(r.int(0, 99999)), b = String(r.int(0, 99999999));
      return (r.chance(0.3) ? '' : a) + '.' + b;
    }
    case 3: { // 指数
      const m = r.chance(0.5) ? String(r.int(1, 9)) : String(r.int(1, 999)) + '.' + r.int(0, 99);
      return m + 'E' + r.pick(['', '-', '+']) + r.int(0, r.chance(0.8) ? 40 : 999);
    }
    case 4: { // 長い数字の列
      let s = String(r.int(1, 9));
      for (let n = r.int(5, 20); n > 0; n--) s += r.int(0, 9);
      if (r.chance(0.5)) s = s.slice(0, r.int(1, s.length - 1)) + '.' + s.slice(r.int(1, s.length - 1));
      return s;
    }
    case 5: return '&H' + r.int(0, 0xffff).toString(16).toUpperCase();
    case 6: return r.pick(NUMVARS);
    default: return r.pick(['PI', 'A(' + r.int(0, 12) + ')', '0', '1', '-1', '.5']);
  }
}

function strLiteral(r) {
  const chars = 'ABCEXYZ 0123456789.,-+!#E';   // E: VAL("1E99") のような指数も作る
  let s = '';
  for (let n = r.int(0, 8); n > 0; n--) s += r.pick([...chars]);
  return '"' + s + '"';
}

function numExpr(r, d, ctx) {
  if (d <= 0 || r.chance(0.25)) return numLiteral(r);
  switch (r.int(0, 9)) {
    case 0: case 1: return numExpr(r, d - 1, ctx) + r.pick(BINOPS) + numExpr(r, d - 1, ctx);
    case 2: return '(' + numExpr(r, d - 1, ctx) + ')';
    case 3: return r.pick(['-', 'NOT ', '+']) + numExpr(r, d - 1, ctx);
    case 4: case 5: return r.pick(FUNCS1) + '(' + numExpr(r, d - 1, ctx) + ')';
    case 6: { const f = r.pick(['LEN', 'ASC', 'VAL', 'VAL']); return f + '(' + (f === 'VAL' && r.chance(0.5) ? numString(r) : strExpr(r, d - 1, ctx)) + ')'; }
    case 7: return r.chance(0.5)
      ? 'INSTR(' + strExpr(r, d - 1, ctx) + ',' + strExpr(r, d - 1, ctx) + ')'
      : 'INSTR(' + numExpr(r, d - 1, ctx) + ',' + strExpr(r, d - 1, ctx) + ',' + strExpr(r, d - 1, ctx) + ')';
    case 8: return strExpr(r, d - 1, ctx) + r.pick(['=', '<>', '<', '>', '<=', '>=']) + strExpr(r, d - 1, ctx);
    default: return ctx.nondet ? r.pick(['RND(1)', 'FRE(0)', 'PEEK(' + r.int(0, 65535) + ')', 'POINT(' + r.int(-5, 100) + ',' + r.int(-5, 40) + ')'])
      : 'A(' + numExpr(r, d - 1, ctx) + ')';
  }
}

// 数の形をした文字列("1E999" など。VAL に渡すと、あふれたり桁が多かったりする)
function numString(r) {
  const sign = r.chance(0.3) ? '-' : '';
  if (r.chance(0.5)) return '"' + sign + r.int(1, 99) + 'E' + r.pick(['', '-']) + r.int(30, 999) + '"';  // あふれやすい指数
  for (;;) { const n = numLiteral(r); if (/^[0-9.&]/.test(n)) return '"' + sign + n + '"'; }
}

function strExpr(r, d, ctx) {
  if (d <= 0 || r.chance(0.3)) return r.pick([strLiteral, numString, () => r.pick(STRVARS)])(r);
  switch (r.int(0, 7)) {
    case 0: return strExpr(r, d - 1, ctx) + '+' + strExpr(r, d - 1, ctx);
    case 1: return 'CHR$(' + (r.chance(0.8) ? r.int(32, 126) : numExpr(r, d - 1, ctx)) + ')';
    case 2: return 'STR$(' + numExpr(r, d - 1, ctx) + ')';
    case 3: return 'HEX$(' + numExpr(r, d - 1, ctx) + ')';
    case 4: return r.pick(['LEFT$', 'RIGHT$']) + '(' + strExpr(r, d - 1, ctx) + ',' + numExpr(r, d - 1, ctx) + ')';
    case 5: return 'MID$(' + strExpr(r, d - 1, ctx) + ',' + numExpr(r, d - 1, ctx) + (r.chance(0.5) ? ',' + numExpr(r, d - 1, ctx) : '') + ')';
    case 6: return 'B$(' + r.int(0, 6) + ')';
    default: return '(' + strExpr(r, d - 1, ctx) + ')';
  }
}

// 58文字に収まるものができるまで作り直す
function fit(r, make) {
  for (let i = 0; i < 50; i++) { const s = make(); if (s.length <= MAXLINE) return s; }
  return make().slice(0, MAXLINE);
}

// 1文字を壊す(エラーの道を通すため)
function mutate(r, s) {
  const junk = '()+-*/^,;:"$ =<>.&E';
  const p = r.int(0, s.length);
  switch (r.int(0, 2)) {
    case 0: return s.slice(0, p) + s.slice(p + 1);
    case 1: return (s.slice(0, p) + r.pick([...junk]) + s.slice(p)).slice(0, MAXLINE);
    default: return s.slice(0, p);
  }
}

// ---- BASIC を動かす ----
// 各件の前に必ず電源を入れ直して、同じ準備をする(一括で動かしても --case で1件だけ動かしても、同じ状態から始まる)。
// 番兵: 1行目の REM と Z$。expr の後で壊れていないかを調べる
const SENTINEL_LINE = '1 REM SENTINEL';
let b = null;
let curTyped = [];   // いまの件で打ったもの(失敗の報告に使う)
let digest = 0;      // いまの件の表示の要約(--repro-check で比べる)
function fresh() {
  b = bootBasic();
  digest = 0;
  // 打ったものと表示を、すべて要約に入れる(b.run のほか、keys が使う b.type と b.settle も。
  // b.run は中で b.type と b.settle を呼ばないので、二重には数えない)
  const run0 = b.run, type0 = b.type, settle0 = b.settle;
  b.run = (line, f) => { const o = run0.call(b, line, f); digest = hash(digest + '|' + line + '|' + o); return o; };
  b.type = (text) => { digest = hash(digest + '|type|' + text); type0.call(b, text); };
  b.settle = (f) => { const ok = settle0.call(b, f); digest = hash(digest + '|out|' + ok + '|' + b.out); return ok; };
  if (VERBOSE) {     // 打ったものと表示を全部出す(b.run も、keys の b.type と b.settle も)
    const run = b.run, typeRaw = b.type, settle = b.settle;
    b.run = (line, f) => { const o = run.call(b, line, f); console.log(`  > ${line}\n    ${JSON.stringify(o)}`); return o; };
    b.type = (text) => { console.log(`  type ${JSON.stringify(text)}`); typeRaw.call(b, text); };
    b.settle = (f) => { const ok = settle.call(b, f); console.log(`    ${JSON.stringify(b.out)}`); return ok; };
  }
  b.lines(SENTINEL_LINE, 'DIM A(12),B$(6)', 'Z$="SENTI"+"NEL"');
  return b;
}
// 1行打って表示を返す。止まったら BREAK を押す(呼んだ側が失敗として扱う)
function type(line, frames = 600) {
  const out = b.run(line, frames);
  if (out.endsWith('(timeout)')) {
    b.m.pressBreak();
    b.settle(600);
  }
  return out;
}
// プログラムの全バイト($07FF から vartab の手前まで)
const programBytes = () => Array.from(b.ram.subarray(0x7ff, b.ram[0xa1] | (b.ram[0xa2] << 8))).join(',');
// 表示から、エコーと最後のプロンプトを除く
function body(line, out) {
  let s = out.startsWith(line) ? out.slice(line.length) : out;
  return s.replace(/\n?C?>$/, '');
}

const failures = [];
function fail(kind, i, reason, typed, extra = '') {
  failures.push({ kind, i, reason });
  console.log(`\n  FAIL  ${kind}:${i}  ${reason}`);
  for (const t of typed.slice(-40)) console.log(`        > ${t}`);
  if (extra) console.log(`        ${extra.replace(/\n/g, '\n        ')}`);
}
function checkViolations(kind, i, typed) {
  const v = takeViolations();
  if (v.length) { fail(kind, i, 'watch violation', typed, v.join('\n')); return false; }
  return true;
}
// 表示の中のエラーが既知のものか
function badError(text) {
  const m = [...text.matchAll(/\?(\S\S) ERROR/g)].map((x) => x[1]).filter((c) => !ERRORS.includes(c));
  return m.length ? m.join(',') : null;
}

// ---- expr ----
function caseExpr(i) {
  const r = rng(`${SEED}:expr:${i}`);
  const typed = curTyped = [];
  const prog0 = programBytes();
  const ctx = { nondet: true };
  for (let k = 0; k < 10; k++) {
    let line;
    switch (r.int(0, 5)) {
      case 5: line = r.pick([r.pick(STRVARS) + '=' + numString(r), 'PRINT VAL(' + r.pick(STRVARS) + ')',
        r.pick(STRVARS) + '=' + numString(r) + '+' + strLiteral(r), 'B$(' + r.int(0, 6) + ')=' + numString(r) + ':?VAL(B$(' + r.int(0, 6) + '))']); break;
      case 0: line = fit(r, () => 'PRINT ' + numExpr(r, r.int(1, 4), ctx)); break;
      case 1: line = fit(r, () => 'PRINT ' + strExpr(r, r.int(1, 4), ctx)); break;
      case 2: line = fit(r, () => r.pick(NUMVARS) + '=' + numExpr(r, r.int(1, 4), ctx)); break;
      case 3: line = fit(r, () => r.pick(STRVARS) + '=' + strExpr(r, r.int(1, 4), ctx)); break;
      default: line = fit(r, () => '?' + numExpr(r, 2, ctx) + r.pick([';', ',', ';"X";']) + strExpr(r, 2, ctx));
    }
    if (r.chance(0.2)) line = mutate(r, line);
    if (/^\s*\d/.test(line)) line = ('?' + line).slice(0, MAXLINE);   // 数で始まるとプログラムの行になってしまう
    typed.push(line);
    const out = type(line);
    if (out.endsWith('(timeout)')) return fail('expr', i, 'did not come back to the prompt', typed, JSON.stringify(out.slice(-80)));
    const e = badError(out);
    if (e) return fail('expr', i, `unknown error ${e}`, typed, JSON.stringify(out));
    if (!checkViolations('expr', i, typed)) return;
    // エラーで抜けても、プログラムとほかの文字列は変わらない
    if (programBytes() !== prog0) return fail('expr', i, 'the program changed', typed, JSON.stringify(body('LIST', type('LIST'))));
    const z = body('PRINT Z$', type('PRINT Z$'));
    if (z !== 'SENTINEL') return fail('expr', i, 'Z$ changed', typed, JSON.stringify(z));
  }
}

// ---- prog ----
// 必ず終わるプログラムを作る。メインの部分とサブルーチンの部分を分ける:
//   メイン: GOTO・ON GOTO・IF THEN 行番号 は、後ろのメインの行へだけ。GOSUB はサブルーチンの行へだけ。
//           FOR の変数(I J K)は FOR の外では書き換えない(開いている FOR と同じ変数の FOR は作らない)
//   END の行: サブルーチンがあるときは、メインの後に END だけの行を置く(サブルーチンへ落ちない)
//   サブルーチン: 1行ずつで、終わりに RETURN。単純な文だけを置き、FOR・NEXT・GOTO・ON・IF・REM・' は置かない
//           (IF は条件が成り立たないと行の残りを飛ばし、REM と ' は行の残りをコメントにするので、RETURN まで
//           届かないことがある)。GOSUB は後ろのサブルーチンの行へだけ。STOP は置いてよい(そこで終わる)
// こうすると、後ろへ戻るのは NEXT(回数が決まっている)と RETURN(GOSUB の次へ)だけで、サブルーチンは
// ループの変数を変えずに必ず戻るか、プログラムを終わらせる。
// (0.11.10 までは、サブルーチンの行がコメントで RETURN を飛ばし、後ろの FOR で外のループの変数を
// 戻すことがあり、終わらないプログラムを作ることがあった。T20-01、種 1110 の prog:883)
// 出力が毎回同じになるように RND などは使わない
export function makeProgram(r) {
  const n = r.int(2, 14);             // メインの行の数
  const ns = r.int(0, 3);             // サブルーチンの行の数
  const nums = [];
  let no = r.int(1, 20);
  for (let k = 0; k < n + (ns ? ns + 1 : 0); k++) { nums.push(no); no += r.int(1, 30); }
  const main = nums.slice(0, n);
  const subNos = ns ? nums.slice(n + 1) : [];
  const ctx = { nondet: false };
  const later = (k) => r.pick(main.slice(k + 1));
  const open = [];          // 開いている FOR の変数
  // k: メインの行の番号(サブルーチンなら -1)、j: サブルーチンの番号(メインなら -1)
  const stmt = (k, j) => {
    const sub = j >= 0;
    const last = !sub && k + 1 >= n;
    switch (r.int(0, 22)) {
      case 0: case 1: return r.pick(NUMVARS) + '=' + numExpr(r, r.int(0, 3), ctx);
      case 2: return r.pick(STRVARS) + '=' + strExpr(r, r.int(0, 3), ctx);
      case 3: case 4: return 'PRINT ' + (r.chance(0.6) ? numExpr(r, r.int(0, 3), ctx) : strExpr(r, r.int(0, 2), ctx)) + r.pick(['', ';', ',', ';" ";' + r.pick(NUMVARS)]);
      case 5:
        if (sub) return 'PRINT 6';
        return 'IF ' + numExpr(r, r.int(0, 2), ctx) + ' THEN ' + (!last && r.chance(0.5) ? String(later(k)) : 'PRINT "T"') + (r.chance(0.4) ? ' ELSE PRINT "F"' : '');
      case 6: return sub ? 'PRINT 4' : last ? 'END' : 'GOTO ' + later(k);
      case 7: { const t = subNos.slice(j + 1); return t.length ? 'GOSUB ' + r.pick(t) : 'PRINT 0'; }
      case 8: case 9: {
        if (!sub && open.length < 3) { const v = r.pick(['I', 'J', 'K'].filter((x) => !open.includes(x))); open.push(v); return 'FOR ' + v + '=' + r.int(-3, 3) + ' TO ' + r.int(-3, 5) + (r.chance(0.3) ? ' STEP ' + r.pick(['1', '2', '-1', '.5']) : ''); }
        return 'PRINT 1';
      }
      case 10: return !sub && open.length ? 'NEXT' + (r.chance(0.5) ? ' ' + open.pop() : (open.pop(), '')) : 'PRINT 2';
      case 11: return 'DIM ' + r.pick(['P', 'Q', 'R$']) + '(' + r.int(0, 8) + ')';
      case 12: return 'DATA ' + [numLiteral(r).replace(/^[A-Z].*/, '7'), strLiteral(r), r.int(0, 99)].slice(0, r.int(1, 3)).join(',');
      case 13: return 'READ ' + r.pick(NUMVARS) + (r.chance(0.3) ? ',' + r.pick(STRVARS) : '');
      case 14: return r.chance(0.5) ? 'RESTORE' : 'RESTORE ' + r.pick(nums);
      case 15: return sub ? 'PRINT 5' : last ? 'STOP' : 'ON ' + r.int(0, 3) + ' GOTO ' + [later(k), later(k)].join(',');
      case 16:
        if (sub) return r.pick(['DEG', 'RAD', r.chance(0.2) ? 'STOP' : 'PRINT 3']);
        return r.pick(['DEG', 'RAD', 'REM ' + strLiteral(r).slice(1, -1), "' X", r.chance(0.2) ? 'STOP' : 'PRINT 3']);
      case 17: return r.pick(['PSET', 'PRESET']) + ' ' + r.int(-5, 100) + ',' + r.int(-5, 40);
      case 18: return 'LINE ' + [r.int(-20, 120), r.int(-20, 50), r.int(-20, 120), r.int(-20, 50)].join(',') + (r.chance(0.3) ? ',2' : '');
      case 19: return 'CIRCLE ' + [r.int(0, 95), r.int(0, 31), r.int(0, 40)].join(',') + (r.chance(0.3) ? ',2' : '');
      case 20: return 'LOCATE ' + r.int(0, 15) + ',' + r.int(0, 3);
      case 21: // VAL: 数の形をした文字列を作って読む(あふれると ?OV で抜ける)
        return r.pick([r.pick(STRVARS) + '=' + numString(r), r.pick(NUMVARS) + '=VAL(' + r.pick(STRVARS) + ')',
          r.pick(NUMVARS) + '=VAL(' + numString(r) + ')', 'R$(' + r.int(0, 9) + ')=' + numString(r) + ':' + r.pick(NUMVARS) + '=VAL(R$(' + r.int(0, 9) + '))']);
      default: return r.pick(['P(' + r.int(0, 9) + ')=1', 'R$(' + r.int(0, 9) + ')="Z"', 'PRINT P(' + r.int(0, 9) + ')']);
    }
  };
  const lines = main.map((num, k) => {
    const saved = [...open];
    for (let t = 0; t < 30; t++) {
      open.splice(0, open.length, ...saved);
      const parts = k === 0 ? ['CLS:RAD'] : [];   // DEG は RUN の後も残るので、初めに戻す
      for (let s = r.int(1, 3); s > 0; s--) parts.push(stmt(k, -1));
      if (k + 1 >= n) while (open.length) parts.push('NEXT ' + open.pop());   // 最後の行で FOR を閉じる
      const l = num + ' ' + parts.join(':');
      if (l.length <= MAXLINE) return l;
    }
    open.splice(0, open.length, ...saved);
    return num + ' REM';
  });
  if (ns) {
    lines.push(nums[n] + ' END');
    subNos.forEach((num, j) => {
      for (let t = 0; t < 30; t++) {
        const parts = [];
        for (let s = r.int(1, 3); s > 0; s--) parts.push(stmt(-1, j));
        const l = num + ' ' + parts.join(':') + ':RETURN';
        if (l.length <= MAXLINE) { lines.push(l); return; }
      }
      lines.push(num + ' RETURN');
    });
  }
  return { nums, lines };
}

// 出力を比べられる形に: 行番号の対応(RENUM の後)を戻す
function normalize(text, map) {
  return text.replace(/ IN (\d+)/g, (m, d) => ' IN ' + (map ? map.get(Number(d)) ?? '?' + d : d));
}

function caseProg(i) {
  const r = rng(`${SEED}:prog:${i}`);
  const { nums, lines } = makeProgram(r);
  const typed = curTyped = ['NEW', ...lines];
  type('NEW');
  for (const l of lines) type(l);
  let bytes = programBytes();   // RUN の後も、プログラムの全バイトが変わらないこと
  let screen = null; // 直前の RUN の後の画面(VRAM)
  const runOnce = (label) => {
    typed.push('RUN');
    const out = type('RUN', 1200);
    if (out.endsWith('(timeout)')) { fail('prog', i, `RUN did not finish (${label})`, typed, JSON.stringify(out.slice(-80))); return null; }
    const e = badError(out);
    if (e) { fail('prog', i, `unknown error ${e} (${label})`, typed, JSON.stringify(out)); return null; }
    // 画面(VRAM)。プロンプトで点滅しているカーソルの1文字分(6バイト)は比べない
    const v = Array.from(b.ram.subarray(0x400, 0x580));
    const cx = b.ram[0xee], cy = b.ram[0xef];
    if (cx < 16 && cy < 4) v.fill(-1, cy * 96 + cx * 6, cy * 96 + cx * 6 + 6);
    screen = v.join(',');
    if (programBytes() !== bytes) { fail('prog', i, `RUN changed the program (${label})`, typed); return null; }
    return body('RUN', out);
  };
  const o1 = runOnce('first');
  if (o1 === null || !checkViolations('prog', i, typed)) return;
  const screen1 = screen;
  const o2 = runOnce('again');
  if (o2 === null) return;
  if (o2 !== o1) return fail('prog', i, 'second RUN differs', typed, `first:  ${JSON.stringify(o1)}\nsecond: ${JSON.stringify(o2)}`);
  if (screen !== screen1) return fail('prog', i, 'the screen after the second RUN differs', typed);

  // LIST の表示を打ち直す
  const listed = nums.map((n) => { typed.push('LIST ' + n); return body('LIST ' + n, type('LIST ' + n)).split('\n')[0]; });
  if (listed.every((l) => l.length <= MAXLINE)) {
    type('NEW');
    typed.push('NEW', ...listed);
    for (const l of listed) type(l);
    if (programBytes() !== bytes) return fail('prog', i, 'retyping the LIST gives different bytes', typed);
    const again = nums.map((n) => body('LIST ' + n, type('LIST ' + n)).split('\n')[0]);
    if (again.join('\n') !== listed.join('\n')) {
      return fail('prog', i, 'LIST of the retyped program differs', typed, again.filter((l, k) => l !== listed[k]).map((l, k) => JSON.stringify(l)).join('\n'));
    }
    const o3 = runOnce('retyped');
    if (o3 === null) return;
    if (o3 !== o1) return fail('prog', i, 'RUN of the retyped program differs', typed, `before: ${JSON.stringify(o1)}\nafter:  ${JSON.stringify(o3)}`);
    if (screen !== screen1) return fail('prog', i, 'the screen after RUN of the retyped program differs', typed);
  }

  // RENUM
  typed.push('RENUM 100,10');
  const rn = type('RENUM 100,10');
  if (!/^RENUM 100,10[^?]*$/.test(rn.replace(/\n?>$/, '')) && !rn.includes('?')) { /* 警告の表示はかまわない */ }
  const map = new Map(nums.map((n, k) => [100 + k * 10, n]));
  bytes = programBytes();
  let screen4 = null;
  if (!rn.includes('?OM') && !rn.includes('?FC')) {
    const o4 = runOnce('after RENUM');
    if (o4 === null) return;
    if (normalize(o4, map) !== o1) return fail('prog', i, 'RUN after RENUM differs', typed, `before: ${JSON.stringify(o1)}\nafter:  ${JSON.stringify(o4)}`);
    screen4 = screen;
    // 行番号が画面に出ないなら、RENUM の前と同じ画面になる
    if (!/ IN \d/.test(o1) && screen4 !== screen1) return fail('prog', i, 'the screen after RUN after RENUM differs', typed);
  }

  // SAVE、NEW、LOAD
  b.m.bus.insertTape([]);
  typed.push('SAVE "F"', 'NEW', 'LOAD "F"');
  type('SAVE "F"'); type('NEW'); type('LOAD "F"');
  if (programBytes() !== bytes) return fail('prog', i, 'LOAD gives different bytes', typed);
  const o5 = runOnce('after LOAD');
  if (o5 === null) return;
  const o5n = rn.includes('?OM') || rn.includes('?FC') ? o5 : normalize(o5, map);
  if (o5n !== o1) return fail('prog', i, 'RUN after SAVE and LOAD differs', typed, `before: ${JSON.stringify(o1)}\nafter:  ${JSON.stringify(o5)}`);
  if (screen4 !== null && screen !== screen4) return fail('prog', i, 'the screen after RUN after LOAD differs', typed);
  checkViolations('prog', i, typed);
}

// ---- edit ----
function caseEdit(i) {
  const r = rng(`${SEED}:edit:${i}`);
  const typed = curTyped = ['NEW'];
  type('NEW');
  const model = new Map(); // 行番号 -> LIST に出るはずの行(ここで作る行は、打った形のまま LIST に出る)
  const bodyText = () => {
    switch (r.int(0, 3)) {
      case 0: return 'REM ' + 'X'.repeat(r.int(0, 50));
      case 1: return 'PRINT "' + 'ABC'.repeat(r.int(0, 15)) + '"';
      case 2: return 'A=' + r.int(0, 999999) + ':B$="' + 'Q'.repeat(r.int(0, 30)) + '"';
      default: return 'X=1';
    }
  };
  const listOf = (n) => body('LIST ' + n, type('LIST ' + n)).split('\n')[0];
  for (let k = 0; k < 40; k++) {
    const op = r.int(0, 9);
    if (op <= 4 || model.size === 0) { // 追加か置き換え
      const n = r.chance(0.3) && model.size ? r.pick([...model.keys()]) : r.int(1, 2000);
      const line = (n + ' ' + bodyText()).slice(0, MAXLINE);
      typed.push(line); type(line);
      model.set(n, line);
      const now = listOf(n);
      if (now !== line) return fail('edit', i, `line ${n} was not stored as typed`, typed, `expected ${JSON.stringify(line)}\ngot      ${JSON.stringify(now)}`);
    } else if (op <= 6) { // 1行を消す
      const n = r.pick([...model.keys()]);
      typed.push(String(n)); type(String(n));
      model.delete(n);
    } else if (op === 7) { // DELETE 範囲
      const ks = [...model.keys()].sort((a, c) => a - c);
      const a = r.pick(ks), c = r.pick(ks.filter((x) => x >= a));
      typed.push(`DELETE ${a}-${c}`); type(`DELETE ${a}-${c}`);
      for (const x of ks) if (x >= a && x <= c) model.delete(x);
    } else { // 変数を作る(プログラムの後ろの領域を動かす)
      const l = r.pick(['A=1:B$="HELLO"+"X":DIM Z(' + r.int(1, 40) + ')', 'C$=STR$(' + r.int(0, 9999) + ')', 'CLEAR']);
      typed.push(l); type(l);
    }
    if (!checkViolations('edit', i, typed)) return;
    // ときどき、全部の行を確かめる
    if (r.chance(0.3) || k === 39) {
      for (const [n, text] of model) {
        const now = listOf(n);
        if (now !== text) return fail('edit', i, `line ${n} changed`, typed, `expected ${JSON.stringify(text)}\ngot      ${JSON.stringify(now)}`);
      }
      // 消した行が残っていないか: プログラムの行の数
      let count = 0, p = 0x800;
      while (b.ram[p] | b.ram[p + 1]) { count++; p = b.ram[p] | (b.ram[p + 1] << 8); }
      if (count !== model.size) return fail('edit', i, `program has ${count} lines, expected ${model.size}`, typed);
    }
  }
}

// ---- keys ----
function caseKeys(i) {
  const r = rng(`${SEED}:keys:${i}`);
  const typed = curTyped = [];
  const keys = [...'ABCXYZ0123456789 +-*/=().,"$:;?', '\x11', '\x12', '\x13', '\x14', '\b', '\b'];
  const show = (s) => s.replace(/\x11/g, '{LEFT}').replace(/\x12/g, '{RIGHT}').replace(/\x13/g, '{UP}').replace(/\x14/g, '{DOWN}').replace(/\b/g, '{DEL}');
  type('NEW');
  type('10 PRINT "HELLO":A=1');
  type('20 REM ' + 'Z'.repeat(r.int(0, 45)));
  const mode = r.int(0, 2);
  if (mode === 1) { type('CALC'); typed.push('CALC'); }
  for (let k = 0; k < 8; k++) {
    let s = '';
    for (let n = r.int(0, 70); n > 0; n--) s += r.pick(keys);
    if (mode === 2 && r.chance(0.5)) { const e = 'EDIT ' + r.pick([10, 20]); typed.push(e); b.type(e + '\n'); b.settle(); }
    typed.push(show(s));
    b.clearOut();
    b.type(s + '\n');
    if (!b.settle(600)) {
      fail('keys', i, 'did not come back to the prompt', typed);
      b.m.pressBreak();
      b.settle(600);
      return;
    }
    const e = badError(b.out);
    if (e) return fail('keys', i, `unknown error ${e}`, typed, JSON.stringify(b.out));
    if (!checkViolations('keys', i, typed)) return;
  }
  if (mode === 1) { b.m.pressBreak(); b.settle(); }
}

// ---- mon ----
// モニターのコマンド(test/fuzz_mon.js)。終わったら BASIC に戻っていて、プログラムと Z$ が残っていること
function caseMon(i) {
  const r = rng(`${SEED}:mon:${i}`);
  const typed = curTyped = [];
  const prog0 = programBytes();
  let failedHere = false;
  typed.push('MON');
  const o = type('MON');
  if (!o.endsWith('*')) return fail('mon', i, 'MON did not enter the monitor', typed, JSON.stringify(o));
  monCase(r, { b: () => b, typed, fail: (reason, extra) => { failedHere = true; fail('mon', i, reason, typed, extra); } });
  if (failedHere) { if (!b.idle()) { b.m.pressBreak(); b.settle(600); } return; }
  if (!checkViolations('mon', i, typed)) return;
  if (programBytes() !== prog0) return fail('mon', i, 'the program changed', typed);
  const z = body('PRINT Z$', type('PRINT Z$'));
  if (z !== 'SENTINEL') return fail('mon', i, 'Z$ changed', typed, JSON.stringify(z));
}

// ---- input ----
// INPUT にでたらめな答えを打つ(test/fuzz_input.js)
function caseInput(i) {
  const r = rng(`${SEED}:input:${i}`);
  const typed = curTyped = [];
  inputCase(r, { b: () => b, typed, fail: (reason, extra) => fail('input', i, reason, typed, extra) });
  if (!b.idle()) { b.m.pressBreak(); b.settle(600); }
}

// ---- files ----
// テープの一覧 FILES とページ送り(test/fuzz_files.js)
function caseFiles(i) {
  const r = rng(`${SEED}:files:${i}`);
  const typed = curTyped = [];
  filesCase(r, { b: () => b, typed, fail: (reason, extra) => fail('files', i, reason, typed, extra) });
  if (!b.idle()) { b.m.pressBreak(); b.settle(600); }
}

// ---- 動かす ----
const RUNNERS = { expr: caseExpr, prog: caseProg, edit: caseEdit, keys: caseKeys, mon: caseMon, input: caseInput, files: caseFiles };
// 1件を動かす。最後に、まだ調べていない見張りの違反がないかを必ず調べる
function runCase(kind, i) {
  fresh();
  curTyped = [];
  const before = failures.length;
  RUNNERS[kind](i);
  const v = takeViolations();
  if (v.length) {
    if (failures.length === before) fail(kind, i, 'watch violation', curTyped, v.join('\n'));
    else console.log(`        (and watch violations)\n        ${v.join('\n        ')}`);
  }
  return hash(digest + '|' + Array.from(b.ram).join(','));   // 打ったもの・表示と、最後のRAM全体の要約
}
// ほかのファイル(test/fuzz_gen.test.js)から makeProgram を読むときは動かさない
const MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (MAIN) {
console.log(`fuzz: seed ${SEED}`);
if (ONE) {
  const [kind, n] = ONE.split(':');
  runCase(kind, Number(n));
} else {
  for (const kind of KINDS) {
    const t0 = Date.now();
    process.stdout.write(`${kind}: `);
    const before = failures.length;
    const digests = [];
    for (let i = 0; i < COUNT; i++) {
      digests.push(runCase(kind, i));
      if (i % 50 === 49) process.stdout.write('.');
    }
    console.log(` ${COUNT} cases, ${failures.length - before} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    if (REPRO) {
      // 一括とは逆の順で動かす(前の件の状態を引き継いでいたら、違いが出る)
      for (let i = Math.min(3, COUNT) - 1; i >= 0; i--) {
        const d = runCase(kind, i);
        if (d !== digests[i]) fail(kind, i, '--case would not repeat the same run (output or memory differs)', curTyped);
      }
    }
  }
}
console.log(failures.length ? `\n${failures.length} failed (seed ${SEED})` : '\nall passed');
process.exit(failures.length ? 1 : 0);
}
