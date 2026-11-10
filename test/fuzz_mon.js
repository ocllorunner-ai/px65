// ファジング: モニターのコマンド(test/fuzz.js の mon)
//
// BASIC から MON でモニターに入り、でたらめなコマンドの行(正しいものと、少し壊したもの)を打つ。
// JavaScript の写し(メモリ、レジスタ、ブレークポイント、テープ、D と U の続きの番地)で期待する結果を計算して比べる。
//   E(並べて書く、1バイトずつ編集する)、F、M、A、L で書いたメモリ
//   H の答え、S と C の表示、B の一覧、R の表示、D の表示、W と L の表示
//   A: 命令表(src/cpu65c02.js の OPCODES)から作った命令の行を打ち、書かれたバイトを、
//      ドキュメントの決まり(2桁以下はゼロページ、3桁以上は絶対番地、ない方は他方で代わり、など)で計算したものと比べる
//   U: 表示した行を、同じ番地で A に打ち直すと、メモリが変わらない(逆アセンブルとアセンブルが往復する)
// 書くのは、ユーザー用の番地($0000-$007F、$0580-$07FE、$2000-$6FFF)だけ。読むのは RAM のその範囲と ROM。
// コマンドの後には毎回、$0000-$00DF と $0580-$7FFF が写しと同じかを調べる(BASIC の作業領域も変わらないこと)。
// 最後に Q で BASIC に戻り、プログラムと変数が残っているかを調べる(test/fuzz.js の側)。
// G・T・P(実行)とブレークポイントは test/fuzz_mon_run.js(でたらめな機械語のプログラムを動かして、止まったときの
// レジスタとメモリを、同じ CPU コアで動かした写しと比べる)。
// 行き先が $00E0-$057F の命令の T・P は、レジスタを表示して ? になり、何も書かないこと。その後の G で止まったときにも、
// 書いていない番地へ書き戻さないこと(B23-01、B24-01)。

import { OPCODES } from '../src/cpu65c02.js';
import { ROM_BIN } from './basic_harness.js';
import { runScenario, TestBug } from './fuzz_mon_run.js';

const LEFT = '\x11', RIGHT = '\x12', UP = '\x13', DOWN = '\x14', DEL = '\b';
const hex = (v, n) => v.toString(16).toUpperCase().padStart(n, '0');
const WRITE_REGIONS = [[0x0000, 0x007f], [0x0580, 0x07fe], [0x2000, 0x6fff]];
const MAXLINE = 58;   // 1行は58文字まで

// ---- 命令表(アセンブラの写しが使う) ----
const MNEMS = new Set(OPCODES.map((o) => o.name));
const MODE_LEN = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, izx: 2, izy: 2, izp: 2, abs: 3, abx: 3, aby: 3, ind: 3, aix: 3, rel: 2, zpr: 3 };
const ONE_BYTE = new Set(['imm', 'zp', 'zpx', 'zpy', 'izx', 'izy', 'izp', 'zpr']);   // 値が $FF までのもの
// オペランドの形ごとに試すアドレッシング(rom/monitor.s の a_short_modes / a_long_modes。説明書の決まり)
const SHORT = { none: ['imp', 'acc'], acc: ['acc', 'zp', 'abs'], imm: ['imm'], v: ['rel', 'zp', 'abs'], vx: ['zpx', 'abx'], vy: ['zpy', 'aby'], ix: ['izx', 'aix'], iy: ['izy'], i: ['izp', 'ind'], zr: ['zpr'] };
const LONG = { none: ['imp', 'acc'], acc: ['acc', 'zp', 'abs'], imm: ['imm'], v: ['rel', 'abs', 'zp'], vx: ['abx', 'zpx'], vy: ['aby', 'zpy'], ix: ['aix', 'izx'], iy: ['izy'], i: ['ind', 'izp'], zr: ['zpr'] };
const findOp = (name, mode) => OPCODES.findIndex((o) => o.name === name && o.mode === mode);
// 正しく書いた命令の行を作れるオペコード(n1 n2 n3 は表にない NOP)
const DOCUMENTED = OPCODES.map((o, op) => (MODE_LEN[o.mode] ? op : -1)).filter((op) => op >= 0);

class AsmError extends Error {}
// 1行をアセンブルする写し。addr に置くときのバイトの配列を返す。間違いなら AsmError
// (rom/monitor.s の asm_one と同じ手順。数の前の空白とカンマは gethex が飛ばす)
export function assembleLine(line, addr) {
  let pos = 0;
  const peek = () => (pos < line.length ? line[pos].toUpperCase() : '');
  const skip = () => { while (peek() === ' ') pos++; };
  const err = () => { throw new AsmError(); };
  const expect = (ch) => { skip(); if (peek() !== ch) err(); pos++; };
  const end = () => { skip(); if (peek() !== '') err(); };
  let long = false;
  const num = () => {
    skip();
    if (peek() === '$') pos++;
    while (peek() === ' ' || peek() === ',') pos++;
    let v = 0, n = 0;
    while (/[0-9A-F]/.test(peek())) { v = ((v << 4) | parseInt(peek(), 16)) & 0xffff; n++; pos++; }
    if (!n) err();
    long = n >= 3;
    return v;
  };
  skip();   // 行の頭の空白(a_line が飛ばす)
  let name = '';
  for (let k = 0; k < 3; k++) { const c = peek(); if (!/[A-Z]/.test(c)) err(); name += c; pos++; }
  if (!MNEMS.has(name)) err();
  let bit = -1;
  if (/[0-7]/.test(peek())) { bit = Number(peek()); pos++; }
  if (peek() !== '' && peek() !== ' ') err();
  skip();
  let cls, val = 0, val2 = 0;
  const c = peek();
  if (c === '') cls = 'none';
  else if (c === '#') { pos++; val = num(); end(); cls = 'imm'; }
  else if (c === '(') {
    pos++; val = num(); skip();
    if (peek() === ',') { pos++; expect('X'); expect(')'); end(); cls = 'ix'; }
    else { expect(')'); skip(); if (peek() === '') cls = 'i'; else { expect(','); expect('Y'); end(); cls = 'iy'; } }
  } else {
    if (c === 'A') {
      const save = pos; pos++; skip();
      if (peek() === '') { cls = 'acc'; val = 0x0a; } else pos = save;
    }
    if (!cls) {
      val = num(); skip();
      if (peek() === '') cls = 'v';
      else {
        expect(','); skip();
        if (peek() === 'X') { pos++; end(); cls = 'vx'; }
        else if (peek() === 'Y') { pos++; end(); cls = 'vy'; }
        else { val2 = num(); end(); cls = 'zr'; }
      }
    }
  }
  let op = -1, mode = null;
  for (const m of (long ? LONG : SHORT)[cls]) {
    if (ONE_BYTE.has(m) && val > 0xff) continue;
    const o = findOp(name, m);
    if (o >= 0) { op = o; mode = m; break; }
  }
  if (op < 0) err();
  if ((op & 7) === 7) { if (bit < 0) err(); op += bit * 16; } else if (bit >= 0) err();
  const offset = (target, from) => {
    const d = (target - from) & 0xffff;
    if (d < 0x80 || d >= 0xff80) return d & 0xff;
    return err();
  };
  if (mode === 'rel') return [op, offset(val, addr + 2)];
  if (mode === 'zpr') return [op, val & 0xff, offset(val2, addr + 3)];
  return [op, val & 0xff, val >> 8].slice(0, MODE_LEN[mode]);
}

// ---- 1件 ----
// env: { b(), rng, fail(reason, extra), typed } (test/fuzz.js が渡す)
export function caseMon(r, env) {
  const b = env.b();
  const typed = env.typed;
  const ram = b.ram;
  let failed = false;
  const fail = (reason, extra = '') => { if (!failed) env.fail(reason, extra); failed = true; };

  // 打って、エコーと最後のプロンプト(* か、キー待ちならなし)を除いた表示を返す
  const run = (line, show = line) => {
    typed.push(show);
    const out = b.run(line);
    if (out.endsWith('(timeout)')) { fail('did not come back', JSON.stringify(out.slice(-80))); return null; }
    return out;
  };
  const bodyOf = (out, echo) => (out.startsWith(echo) ? out.slice(echo.length) : out).replace(/\n?\*$/, '').replace(/\s+$/, '');

  // ---- 写し ----
  const mem = Uint8Array.from(ram);
  const read = (a) => (a < 0x8000 ? mem[a] : ROM_BIN[a - 0xa000]);
  const write = (a, v) => { a &= 0xffff; if (a < 0x8000) mem[a] = v; };
  const regs = {};
  const bps = [null, null, null, null];
  const tape = [];
  let dnext = null, unext = null, aaddr = null;
  const exec = { fresh: true };   // 次の実行で、モニターへの戻り番地を積むか(MON で入ったとき、L の後、RTS で戻った後)

  const compareMem = (what) => {
    for (const [lo, hi] of [[0x0000, 0x00df], [0x0580, 0x7fff]]) {
      for (let a = lo; a <= hi; a++) {
        if (ram[a] !== mem[a]) { fail(`memory differs after ${what}`, `$${hex(a, 4)}: got ${hex(ram[a], 2)} want ${hex(mem[a], 2)}`); return false; }
      }
    }
    return true;
  };

  // ---- 数と番地を作る ----
  const caseRand = (s) => (r.chance(0.2) ? s.toLowerCase() : s);
  const hexText = (v) => caseRand('0'.repeat(r.int(0, 3) === 0 ? r.int(1, 2) : 0) + hex(v, 1));
  const sep = () => r.pick([' ', ' ', '  ', ',', ' , ']);
  // 長さ len を書ける番地(書いてよい範囲の中)
  const writable = (len) => {
    const [lo, hi] = r.pick(WRITE_REGIONS.filter(([l, h]) => h - l + 1 >= len + 40));
    return r.int(lo + 20, hi - len - 20);
  };
  // 読んでよい番地(書いてよい範囲か ROM)
  const readable = (len) => (r.chance(0.25) ? r.int(0xa000, 0xffff - len) : writable(len));

  // ---- 初めの状態を読む ----
  {
    const out = run('R');
    if (out === null) return;
    const m = bodyOf(out, 'R').match(/^A=(..) X=(..) Y=(..)\nS=(..) P=(........)\n([0-9A-F]{4}) /);
    if (!m) return fail('cannot read registers', JSON.stringify(out));
    Object.assign(regs, { a: parseInt(m[1], 16), x: parseInt(m[2], 16), y: parseInt(m[3], 16), s: parseInt(m[4], 16), pc: parseInt(m[6], 16) });
    // P の値(表示はビット5を - にするが、ビット5はいつも1)
    regs.p = [...m[5]].reduce((v, ch, k) => v | (ch !== '.' ? 0x80 >> k : 0), 0) | 0x20;
    const bo = run('B');
    if (bodyOf(bo, 'B') !== '-') return fail('breakpoints at start', JSON.stringify(bo));
  }
  const flags = (p) => [...'NV-BDIZC'].map((ch, k) => (k === 2 ? '-' : (p & (0x80 >> k) ? ch : '.'))).join('');
  const bpList = () => {
    const live = bps.filter((v) => v !== null);
    if (!live.length) return '-';
    return live.map((v, k) => hex(v, 4) + ((k + 1) % 3 === 0 ? '\n' : ' ')).join('').trim();
  };
  // ブレークポイントを置けない番地(モニターと BIOS のゼロページ、スタック、作業領域、入力行、VRAM。B23-01)
  const bpProtected = (a) => a >= 0x00e0 && a <= 0x057f;
  // B で試す番地: 境目のまわりと、置けない範囲を多めに
  const bpAddr = () => (r.chance(0.3) ? r.pick([0xdf, 0xe0, 0x57f, 0x580, 0x7fff, r.int(0xd8, 0xe8), r.int(0x578, 0x588), r.int(0xe0, 0x57f)]) : r.int(0, 0x7fff));
  const addr3 = (list) => list.map((v, k) => hex(v, 4) + ((k + 1) % 3 === 0 ? '\n' : ' ')).join('').trim();

  // ---- コマンド ----
  // line を打ち、表示が want(null なら調べない)かを調べる
  const expectBody = (line, want, what) => {
    const out = run(line);
    if (out === null) return null;
    const got = bodyOf(out, line);
    if (want !== null && got !== want) { fail(`${what}: unexpected output`, `got ${JSON.stringify(got)}\nwant ${JSON.stringify(want)}`); return null; }
    return got;
  };
  const isReadable = (a, len) => (a >= 0xa000 && a + len - 1 <= 0xffff) || WRITE_REGIONS.some(([lo, hi]) => a >= lo && a + len - 1 <= hi);
  // D・U をキーで抜ける。文字のキーなら、それが次の行の1文字目になる(rom/monitor.s の unget)。
  // その文字だけの行(RET)を打って、結果を確かめる: H と x はエラー、B は一覧、R はレジスタの表示
  const leave = (what) => {
    const ex = r.pick([LEFT, RIGHT, 'H', 'B', 'R', 'x']);
    typed.push('  key ' + JSON.stringify(ex));
    b.clearOut(); b.type(ex);
    if (!b.settle(600)) { fail(`${what} did not end`); return; }
    if (ex === LEFT || ex === RIGHT) return;
    const want = ex === 'B' ? bpList() : ex === 'R' ? null : '?';
    typed.push(`  (RET after ${ex})`);
    b.clearOut(); b.type('\r');
    if (!b.settle(600)) { fail(`${what}: the next line did not end`); return; }
    const got = b.out.replace(/^\n/, '').replace(/\n?\*$/, '').replace(/\s+$/, '');
    if (want !== null && got !== want) fail(`${what}: the key ${ex} did not start the next command`, `got ${JSON.stringify(b.out)}\nwant ${JSON.stringify(want)}`);
    if (ex === 'R' && !got.startsWith(`A=${hex(regs.a, 2)} X=${hex(regs.x, 2)}`)) fail(`${what}: the key R did not show the registers`, JSON.stringify(b.out));
  };

  const steps = r.int(8, 16);
  for (let k = 0; k < steps && !failed; k++) {
    let line, want = null, what;
    const L = (letter) => caseRand(letter);
    switch (r.int(0, 18)) {
      case 0: case 1: { // E 番地 値 ...
        const n = r.int(1, 16);
        const a = writable(n);
        let vals = [];
        let parts = [];
        while (vals.length < n) {
          if (r.chance(0.2)) {
            const len = r.int(0, Math.min(5, n - vals.length));
            const str = Array.from({ length: len }, () => r.pick([...'ABCxyz019 !#*']));
            parts.push('"' + str.join('') + '"');
            vals.push(...str.map((ch) => ch.charCodeAt(0)));
          } else { const v = r.int(0, 255); vals.push(v); parts.push(hexText(v)); }
        }
        // 番地は16進数の下4桁(5桁以上は上が捨てられる)
        line = L('E') + (r.chance(0.1) ? '1' + hex(a, 4) : hexText(a)) + sep() + parts.join(sep());
        if (line.length > MAXLINE) {   // 1行は58文字まで。詰めて書く
          parts = vals.map((v) => hex(v, 2));
          line = 'E' + hex(a, 4) + ' ' + parts.join(' ');
        }
        vals.forEach((v, j) => write(a + j, v));
        what = 'E list'; want = '';
        break;
      }
      case 2: { // E 番地(1バイトずつ編集)
        const a0 = writable(60);
        line = L('E') + hexText(a0);
        what = 'E edit';
        if (run(line) === null) break;
        let a = a0, cnt = 0, val = 0, keys = '';
        const store = () => { if (cnt) write(a, val); };
        for (let n = r.int(1, 25); n > 0; n--) {
          const kk = r.pick(['d', 'd', 'd', ' ', DOWN, UP, DEL, LEFT, 'g', 'Z', '.']);
          if (kk === 'd') { const d = r.int(0, 15); keys += caseRand(hex(d, 1)); if (cnt < 2) { val = ((val << 4) | d) & 0xff; cnt++; } }
          else if (kk === DEL || kk === LEFT) { keys += kk; if (cnt) { cnt--; val >>= 4; } }
          else if (kk === ' ' || kk === DOWN) { keys += kk; store(); a = (a + 1) & 0xffff; cnt = 0; val = 0; }
          else if (kk === UP) { keys += kk; store(); a = (a - 1) & 0xffff; cnt = 0; val = 0; }
          else keys += kk;
        }
        keys += '\r';
        store();
        typed.push('  keys ' + JSON.stringify(keys));
        b.clearOut(); b.type(keys);
        if (!b.settle(600)) { fail('E edit did not end'); break; }
        if (!/\*$/.test(b.out)) { fail('E edit: no prompt', JSON.stringify(b.out.slice(-60))); break; }
        want = undefined;
        break;
      }
      case 3: { // F 開始 終了 値 ...
        const len = r.int(1, 200);
        const st = writable(len);
        const vals = Array.from({ length: r.int(1, 4) }, () => r.int(0, 255));
        line = L('F') + hexText(st) + sep() + hexText(st + len - 1) + sep() + vals.map((v) => hexText(v)).join(sep());
        for (let j = 0; j < len; j++) write(st + j, vals[j % vals.length]);
        what = 'F'; want = '';
        break;
      }
      case 4: { // M 開始 終了 転送先(重なってもよい)
        // 0 ばかりだと、写し方を間違えても分からないので、でたらめなバイトを置いてから写すことが多い
        const fill = r.chance(0.7);
        const len = fill ? r.int(1, 48) : r.int(1, 120);
        const st = writable(len + 130) + 65;
        if (fill) {
          for (let off = 0; off < len && !failed; off += 16) {
            const vals = Array.from({ length: Math.min(16, len - off) }, () => r.int(0, 255));
            vals.forEach((v, j) => write(st + off + j, v));
            expectBody('E' + hex(st + off, 4) + ' ' + vals.map((v) => hex(v, 2)).join(' '), '', 'E for M');
          }
          if (failed) break;
        }
        const d = r.chance(0.5) ? st + r.int(-60, 60) : writable(len);
        const copy = Array.from({ length: len }, (_, j) => read(st + j));
        line = L('M') + hexText(st) + sep() + hexText(st + len - 1) + sep() + hexText(d);
        copy.forEach((v, j) => write(d + j, v));
        what = 'M'; want = '';
        break;
      }
      case 5: { // S 開始 終了 値 ...
        const len = r.int(1, 300);
        const st = readable(len + 20);
        const n = r.int(1, 3);
        const at = st + r.int(0, len - 1);   // 見つかるように、範囲の中のバイトを使うことが多い
        const pat = Array.from({ length: n }, (_, j) => (r.chance(0.8) ? read(at + j) : r.int(0, 255)));
        line = L('S') + hexText(st) + sep() + hexText(st + len - 1) + sep() + pat.map((v) => hexText(v)).join(sep());
        const found = [];
        for (let a = st; a <= st + len - 1; a++) if (pat.every((v, j) => read(a + j) === v)) found.push(a);
        what = 'S'; want = addr3(found);
        break;
      }
      case 6: { // C 開始 終了 比較先
        const len = r.int(1, 40);
        const st = readable(len + 10);
        const d = r.chance(0.5) ? st + r.int(1, 8) : readable(len);
        if (!isReadable(d, len)) continue;
        line = L('C') + hexText(st) + sep() + hexText(st + len - 1) + sep() + hexText(d);
        const lines = [];
        for (let j = 0; j < len; j++) if (read(st + j) !== read(d + j)) lines.push(`${hex(st + j, 4)} ${hex(read(st + j), 2)} ${hex(d + j, 4)} ${hex(read(d + j), 2)}`);
        what = 'C'; want = lines.join('\n');
        break;
      }
      case 7: { // H 値1 値2
        const x = r.int(0, 0xffff), y = r.int(0, 0xffff);
        line = L('H') + hexText(x) + sep() + hexText(y);
        what = 'H'; want = hex((x + y) & 0xffff, 4) + ' ' + hex((x - y) & 0xffff, 4);
        break;
      }
      case 8: { // B(続けていくつか打つ。5つ目を置こうとするとエラー。$00E0-$057F には置けない。B23-01)
        what = 'B';
        for (let n = r.int(0, 4); n > 0 && !failed; n--) {
          const a = bpAddr();
          const ln = L('B') + ' ' + hexText(a);
          let w;
          if (bpProtected(a)) w = '?';
          else if (bps.includes(a)) w = bpList();
          else { const f = bps.indexOf(null); if (f < 0) w = '?'; else { bps[f] = a; w = bpList(); } }
          expectBody(ln, w, 'B add');
        }
        if (failed) break;
        const sub = r.int(0, 4);
        const live = bps.filter((v) => v !== null);
        if (sub === 0) { line = L('B'); want = bpList(); }
        else if (sub <= 2) {
          const a = r.chance(0.15) ? r.int(0x8000, 0xffff) : (r.chance(0.3) && live.length ? r.pick(live) : bpAddr());
          line = L('B') + sep() + hexText(a);
          if (a >= 0x8000 || bpProtected(a)) want = '?';
          else if (bps.includes(a)) want = bpList();
          else { const f = bps.indexOf(null); if (f < 0) want = '?'; else { bps[f] = a; want = bpList(); } }
        } else if (sub === 3) {
          const a = r.chance(0.6) && live.length ? r.pick(live) : r.int(0, 0x7fff);
          line = L('B') + ' - ' + hexText(a);
          const f = bps.indexOf(a);
          if (f < 0) want = '?'; else { bps[f] = null; want = bpList(); }
        } else { line = L('B') + ' -'; bps.fill(null); want = '-'; }
        break;
      }
      case 9: { // R(表示か、変える)
        what = 'R';
        if (r.chance(0.4)) {
          line = L('R');
          const w = `A=${hex(regs.a, 2)} X=${hex(regs.x, 2)} Y=${hex(regs.y, 2)}\nS=${hex(regs.s, 2)} P=${flags(regs.p)}\n${hex(regs.pc, 4)} `;
          const got = expectBody(line, null, what);
          if (got === null) break;
          if (got.slice(0, w.length) !== w) fail('R: unexpected output', `got ${JSON.stringify(got)}\nwant ${JSON.stringify(w)}...`);
          continue;
        }
        const reg = r.pick(['A', 'X', 'Y', 'S', 'P', 'PC']);
        const v = reg === 'PC' ? r.int(0, 0xffff) : r.int(0, 0xff);
        line = L('R') + sep() + caseRand(reg) + ' ' + hexText(v);
        if (reg === 'PC') regs.pc = v; else if (reg === 'P') regs.p = v; else regs[reg.toLowerCase()] = v;
        what = 'R set'; want = '';
        break;
      }
      case 10: case 11: { // A: 命令を何行か
        const cont = aaddr !== null && isReadable(aaddr, 60) && aaddr < 0x8000 && r.chance(0.2);
        const start = cont ? aaddr : writable(60);
        line = L('A') + (cont ? '' : ' ' + hexText(start));
        what = 'A';
        if (run(line) === null) break;
        let a = start;
        for (let n = r.int(1, 6); n > 0 && !failed; n--) {
          let text = instrText(r, a, caseRand);
          const generated = r.chance(0.75);
          if (!generated) text = mutateAsm(r, text);
          if (!text.trim()) break;   // 空の行は A を終わらせる
          let bytes = null;
          try { bytes = assembleLine(text, a); } catch (e) { if (!(e instanceof AsmError)) throw e; }
          if (generated && bytes === null) { fail('A: the model rejects a generated line (test bug)', JSON.stringify(text)); break; }
          const out = run(text);
          if (out === null) break;
          if (bytes === null) {
            if (!/\?\n?[0-9A-F]{4} $/.test(out)) { fail('A: expected an error', `${JSON.stringify(text)} -> ${JSON.stringify(out)}`); break; }
          } else {
            bytes.forEach((v, j) => write(a + j, v));
            a = (a + bytes.length) & 0xffff;
            if (!out.endsWith(hex(a, 4) + ' ') || /\?/.test(out)) { fail('A: unexpected result', `${JSON.stringify(text)} -> ${JSON.stringify(out)} (want next ${hex(a, 4)}, bytes ${bytes.map((v) => hex(v, 2)).join(' ')})`); break; }
          }
          if (!compareMem(`A ${JSON.stringify(text)}`)) break;
        }
        if (failed) break;
        if (run('') === null) break;
        aaddr = a;
        unext = start;
        want = undefined;
        break;
      }
      case 12: { // U と、表示した行の A への打ち直し
        // 読む番地: 書いてよい範囲にでたらめなバイトを置いたところか、ROM
        let a0;
        if (r.chance(0.6)) {
          a0 = writable(64);
          for (let j = 0; j < 40; j++) write(a0 + j, r.int(0, 255));
          for (let off = 0; off < 40; off += 16) {
            const l = 'E' + hex(a0 + off, 4) + ' ' + Array.from({ length: Math.min(16, 40 - off) }, (_, j) => hex(mem[a0 + off + j], 2)).join(' ');
            if (expectBody(l, '', 'E for U') === null) break;
          }
          if (failed) break;
        } else a0 = r.int(0xa000, 0xffe0);
        const useNext = unext !== null && isReadable(unext, 40) && r.chance(0.15);
        const ua = useNext ? unext : a0;
        line = L('U') + (useNext ? '' : ' ' + hexText(a0));
        what = 'U';
        const out = run(line);
        if (out === null) break;
        let shown = out.slice(line.length);
        // ページ送り: ↓ で1行、RET か SPACE で4行
        for (let n = r.int(0, 2); n > 0; n--) {
          const key = r.pick([DOWN, '\r', ' ']);
          typed.push('  key ' + JSON.stringify(key));
          b.clearOut(); b.type(key);
          if (!b.settle(600)) { fail('U paging did not wait'); break; }
          shown += b.out;
        }
        if (failed) break;
        // 表示した行: "AAAA MNE ..."
        const rows = shown.split('\n').map((x) => x.trim()).filter((x) => /^[0-9A-F]{4} /.test(x));
        if (!rows.length || parseInt(rows[0].slice(0, 4), 16) !== ua) { fail('U: unexpected first line', JSON.stringify(shown)); break; }
        let next = ua;
        for (const row of rows) {
          const ra = parseInt(row.slice(0, 4), 16);
          if (ra !== next) { fail('U: addresses do not follow', JSON.stringify(rows)); break; }
          const op = read(ra);
          const len = MODE_LEN[OPCODES[op].mode] ?? { n1: 1, n2: 2, n3: 3 }[OPCODES[op].mode];
          next = (ra + len) & 0xffff;
          // 表にある命令なら、表示をアセンブルすると同じバイトになる(写しで確かめる)
          if (MODE_LEN[OPCODES[op].mode]) {
            let bytes = null;
            try { bytes = assembleLine(row.slice(5), ra); } catch (e) { if (!(e instanceof AsmError)) throw e; }
            const orig = Array.from({ length: len }, (_, j) => read((ra + j) & 0xffff));
            if (!bytes || bytes.join() !== orig.join()) { fail('U: the line does not assemble back to the same bytes', `${row} -> ${bytes && bytes.map((v) => hex(v, 2)).join(' ')} (memory ${orig.map((v) => hex(v, 2)).join(' ')})`); break; }
          }
        }
        if (failed) break;
        leave('U');
        if (failed) break;
        unext = next;
        // 書いてよい範囲なら、表示した1行を実際に A で打ち直して、メモリが変わらないことを確かめる
        if (ua < 0x8000) {
          const ok = rows.filter((row) => MODE_LEN[OPCODES[read(parseInt(row.slice(0, 4), 16))].mode]);
          if (ok.length) {
            const row = ok[r.int(0, ok.length - 1)];
            const fa = parseInt(row.slice(0, 4), 16);
            if (run('A ' + hex(fa, 4)) === null || run(row.slice(5)) === null || run('') === null) break;
            aaddr = (fa + assembleLine(row.slice(5), fa).length) & 0xffff;
            unext = fa;
          }
        }
        want = undefined;
        break;
      }
      case 13: { // D(ページ送りも)
        const useNext = dnext !== null && isReadable(dnext, 80) && r.chance(0.2);
        const a0 = useNext ? dnext : readable(80) + 16;
        line = L('D') + (useNext ? '' : ' ' + hexText(a0));
        what = 'D';
        let a = a0;
        const out = run(line);
        if (out === null) break;
        const page = (o, at) => {
          const w = Array.from({ length: 4 }, (_, row) => hex((at + row * 4) & 0xffff, 4) + Array.from({ length: 4 }, (_, j) => ' ' + hex(read((at + row * 4 + j) & 0xffff), 2)).join('')).join('\n');
          const got = o.slice(o.lastIndexOf('\f') + 1);
          if (got !== w) fail('D: unexpected dump', `got ${JSON.stringify(got)}\nwant ${JSON.stringify(w)}`);
        };
        page(out, a);
        for (let n = r.int(0, 3); n > 0 && !failed; n--) {
          const key = r.pick([DOWN, UP, '\r', ' ']);
          a = (a + (key === DOWN ? 4 : key === UP ? -4 : 16)) & 0xffff;
          typed.push('  key ' + JSON.stringify(key));
          b.clearOut(); b.type(key);
          if (!b.settle(600)) { fail('D paging did not wait'); break; }
          page(b.out, a);
        }
        if (failed) break;
        leave('D');
        dnext = (a + 16) & 0xffff;
        want = undefined;
        break;
      }
      case 14: { // W と L
        const len = r.int(1, 64);
        const name = r.chance(0.2) ? null : Array.from({ length: r.int(0, 10) }, () => r.pick([...'AB12 x'])).join('');
        what = 'W/L';
        if (r.chance(0.6) || !tape.length) {
          const st = readable(len);
          line = L('W') + hexText(st) + sep() + hexText(st + len - 1) + (name === null ? '' : ' "' + name + '"');
          tape.push({ name: (name ?? '').slice(0, 8).padEnd(8, ' '), start: st, data: Array.from({ length: len }, (_, j) => read(st + j)) });
          want = `SAVE ${hex(st, 4)}-${hex(st + len - 1, 4)}`;
        } else {
          const nm = name === null ? null : name.slice(0, 8).padEnd(8, ' ');
          // 名前を省くと最初のブロック、名前があれば同じ名前の最後のもの
          const blk = nm === null ? tape[0] : tape.filter((t) => t.name === nm).at(-1);
          const to = r.chance(0.5) ? null : writable(70);
          line = L('L') + (name === null ? '' : ' "' + name + '"') + (to === null ? '' : ' ' + hexText(to));
          if (!blk) want = 'NOT FOUND';
          else {
            const at = to ?? blk.start;
            blk.data.forEach((v, j) => write(at + j, v));
            regs.pc = at; regs.s = 0xff; dnext = at; unext = at; exec.fresh = true;
            want = `LOAD ${hex(at, 4)}-${hex(at + blk.data.length - 1, 4)}`;
          }
        }
        break;
      }
      case 15: case 16: { // G・T・P・B でプログラムを動かす(test/fuzz_mon_run.js)
        what = 'run';
        try {
          runScenario({
            r, b, mem, regs, bps, exec, typed, run, bodyOf, expectBody, compareMem, write, bpList, caseRand, hexText,
            fail, isFailed: () => failed,
          });
        } catch (e) {
          // 写しが決めた範囲の外を読み書きした、など(テストの誤り)
          if (e instanceof TestBug) fail('run: test bug', e.message); else throw e;
        }
        want = undefined;
        break;
      }
      case 17: { // T・P の行き先が $00E0-$057F: レジスタを表示して ? になり、何も書かない。
        // その後の G でも、書いていない番地へ書き戻さない(B23-01、B24-01)
        what = 'refused step';
        const prot = (lo = 0xe0) => r.int(lo, 0x57f);
        const kind = r.chance(0.5) ? 0 : r.int(1, 3);
        let a, bytes;
        if (kind === 0) {   // 条件分岐・BRA・BBR・BBS: 片方の行き先だけが範囲の中
          a = r.int(0x582, 0x5f0);
          if (r.chance(0.7)) {
            const t = prot(Math.max(0xe0, a + 2 - 128));
            bytes = [r.pick([0x10, 0x30, 0x50, 0x70, 0x90, 0xb0, 0xd0, 0xf0, 0x80]), (t - (a + 2)) & 0xff];
          } else {
            const t = prot(Math.max(0xe0, a + 3 - 128));
            bytes = [r.pick([0x0f, 0x8f]) + 16 * r.int(0, 7), r.int(0, 0x7f), (t - (a + 3)) & 0xff];
          }
          // 範囲の外の側の行き先(次の命令)に 0 でないバイトを置く。書き戻されると変わるのが分かるように
          bytes.push(r.int(1, 255));
        } else {
          a = writable(8);
          const t = prot();
          if (kind === 1) bytes = [0x4c, t & 0xff, t >> 8];                                      // JMP
          else if (kind === 2) bytes = [0x20, t & 0xff, t >> 8];                                 // JSR(T だけ)
          else bytes = [0x6c, (a + 3) & 0xff, (a + 3) >> 8, t & 0xff, t >> 8];                    // JMP (a+3)
        }
        bytes.forEach((v, j) => write(a + j, v));
        if (expectBody('E' + hex(a, 4) + ' ' + bytes.map((v) => hex(v, 2)).join(' '), '', 'E for refused step') === null) break;
        if (expectBody(L('R') + ' PC ' + hexText(a), '', 'R PC') === null) break;
        regs.pc = a;
        const letter = kind === 2 || r.chance(0.5) ? L('T') : L('P');
        line = letter + (r.chance(0.5) ? '' : ' ' + hexText(r.int(1, 0x20)));
        const got = expectBody(line, null, what);
        if (got === null) break;
        const w = `A=${hex(regs.a, 2)} X=${hex(regs.x, 2)} Y=${hex(regs.y, 2)}\nS=${hex(regs.s, 2)} P=${flags(regs.p)}\n${hex(a, 4)} `;
        if (!got.startsWith(w) || !got.endsWith('\n?')) { fail('refused step: unexpected output', `got ${JSON.stringify(got)}\nwant ${JSON.stringify(w)}...\n?`); break; }
        if (!compareMem(`refused ${line}`)) break;
        // RTS だけのプログラムを G で動かす。止まったときに、拒否した候補を書き戻していないこと
        if (r.chance(0.7)) {
          const g = writable(2);
          write(g, 0x60);
          if (expectBody('E' + hex(g, 4) + ' 60', '', 'E RTS') === null) break;
          line = L('G') + ' ' + hexText(g);
          regs.s = 0xff; regs.p |= 0x30; regs.pc = g; exec.fresh = true;
          want = `A=${hex(regs.a, 2)} X=${hex(regs.x, 2)} Y=${hex(regs.y, 2)}\nS=FF P=${flags(regs.p)}`;
          what = 'G after a refused step';
          break;
        }
        want = undefined;
        break;
      }
      default: { // エラーになる行(番地を読み終わってから気付くものも)
        what = 'error';
        line = r.pick([
          () => r.pick([...'XYZIJKNOV0123456789*#=+.!']) + Array.from({ length: r.int(0, 8) }, () => r.pick([...'0123 ABCX'])).join(''),
          () => L('H') + ' ' + hexText(r.int(0, 0xffff)),
          () => L('E') + ' ' + hexText(writable(4)) + ' ' + hex(r.int(0x100, 0xfff), 3),
          () => L('E') + ' ' + hexText(writable(20)) + ' ' + Array.from({ length: 17 }, () => '1').join(' '),
          () => L('F') + ' 3000 2FFF 1',
          () => L('M') + ' 2000 2010',
          () => L('C') + ' 2000',
          () => L('R') + ' Q 1',
          () => L('R') + ' A 100',
          () => L('H') + ' 1 2 3',
          () => L('D') + ' 2000 1',
          () => L('E') + ' 2000 ""',
          () => L('Q') + ' 1',
          () => L('S') + ' 2000 2100',
          () => L('T') + ' 0',
          () => L('P') + ' ' + hexText(r.int(0x100, 0xffff)),
          () => L('G') + ' 600 1',
          () => L('B') + ' - 7FFF',   // 置いていないブレークポイント(下で、置いていないときだけ使う)
        ])();
        if (/^b - 7fff$/i.test(line) && bps.includes(0x7fff)) continue;
        want = '?';
      }
    }
    if (failed) break;
    if (want === undefined) { if (!compareMem(what)) break; continue; }
    if (line === undefined) continue;
    if (expectBody(line, want, what) === null && failed) break;
    if (!compareMem(`${what} ${JSON.stringify(line)}`)) break;
  }
  if (failed) return;
  // BASIC へ戻る
  const q = run('Q');
  if (q === null) return;
  if (!q.endsWith('>')) fail('Q did not return to BASIC', JSON.stringify(q));
}

// 命令表のオペコードから、正しく書いた命令の行を作る(番地 addr に置く)
function instrText(r, addr, caseRand) {
  const op = r.pick(DOCUMENTED);
  const { name, mode } = OPCODES[op];
  let mn = name;
  if ((op & 7) === 7) mn += String((op >> 4) & 7);
  const d = (v, short) => {
    // 2桁以下でゼロページ、3桁以上で絶対番地
    const n = short ? r.int(v > 0xf ? 2 : 1, 2) : r.int(v > 0xfff ? 4 : 3, 4);
    return (r.chance(0.3) ? '$' : '') + caseRand(hex(v, n));
  };
  const s = () => (r.chance(0.2) ? ' ' : '');
  const v8 = r.int(0, 255), v16 = r.int(0, 0xffff);
  const near = (from) => (from + r.int(-128, 127)) & 0xffff;
  let opr;
  switch (mode) {
    case 'imp': opr = ''; break;
    case 'acc': opr = r.chance(0.5) ? '' : 'A'; break;
    case 'imm': opr = '#' + d(v8, true); break;
    case 'zp': opr = d(v8, true); break;
    case 'zpx': opr = d(v8, true) + s() + ',' + s() + 'X'; break;
    case 'zpy': opr = d(v8, true) + s() + ',' + s() + 'Y'; break;
    case 'izx': opr = '(' + s() + d(v8, true) + s() + ',' + s() + 'X' + s() + ')'; break;
    case 'izy': opr = '(' + d(v8, true) + ')' + s() + ',' + s() + 'Y'; break;
    case 'izp': opr = '(' + d(v8, true) + s() + ')'; break;
    case 'abs': opr = d(v16, false); break;
    case 'abx': opr = d(v16, false) + ',X'; break;
    case 'aby': opr = d(v16, false) + ',Y'; break;
    case 'ind': opr = '(' + d(v16, false) + ')'; break;
    case 'aix': opr = '(' + d(v16, false) + ',X)'; break;
    case 'rel': opr = d(near(addr + 2), r.chance(0.3)); break;
    case 'zpr': opr = d(v8, true) + ',' + d(near(addr + 3), false); break;
    default: throw new Error(mode);
  }
  const text = caseRand(mn) + (opr ? ' '.repeat(r.int(1, 2)) + opr : '');
  return text;
}

// 命令の行を少し壊す(1文字を入れる・消す・換える)
function mutateAsm(r, text) {
  const chars = [...'ABCDEFXYZ0123456789#(),$ '];
  const p = r.int(0, text.length);
  switch (r.int(0, 2)) {
    case 0: return text.slice(0, p) + r.pick(chars) + text.slice(p);
    case 1: return text.slice(0, p) + text.slice(p + 1);
    default: return text.slice(0, p) + r.pick(chars) + text.slice(p + 1);
  }
}
