// ファジング: モニターの G・T・P(実行)とブレークポイント(test/fuzz_mon.js から呼ぶ)
//
// でたらめな機械語のプログラムを作って E で書き込み、G・T・P・B で動かして、止まったときのレジスタの表示と
// メモリを、JavaScript の写しと比べる。写しは同じ CPU コア(src/cpu65c02.js)でプログラムを1命令ずつ動かし、
// 説明書(docs/monitor.md)の決まりで止まるところを決める。
//   G 番地  S=FF から始め、RTS でモニターに戻る(PC の行は出さない)
//   G       止まったところから続ける。PC にブレークポイントがあれば、その命令を実行してから置く
//   ブレークポイント  その番地の命令を実行する前に止まる(PC = その番地)。T と P の間は使わない
//   BRK     PC = BRK の2バイト後ろで止まる
//   BREAK キー  次に実行する命令で止まる(B フラグは立たない)
//   T [回数]  1命令ずつ。JSR は中に入る
//   P [回数]  T と同じだが、JSR はサブルーチンから戻るまでまとめて実行する
// 止まった後は、書いたメモリがすべて元に戻っている(BRK が残らない)ことも調べる(呼んだ側の compareMem)。
//
// 作るプログラムは、どの道を通っても、決めた範囲だけを読み書きし、必ず終わる:
//   読み書きするのは、ゼロページの $00-$7F(ただし $40-$4F はポインタで、書かない)と、データの 512 バイト W..W+$1FF
//   (W..W+7 はジャンプ表で、書かない)。添字やポインタを使う命令も、どんな値でもこの範囲に収まるように作る
//   後ろへ戻るのはループ(Y か X を数える。中では数えるレジスタを変えない)と、RTS・RTI だけ。ほかは前へ進む
//   スタックは、1つの「項目」の中で積んで戻す(分岐が項目の途中に入らないので、どの道でも釣り合う)
//   終わり方: RTS、BRK、SEI のあとの自分へのジャンプ(JMP * か BRA *。BREAK キーで止める)
// 写しの実行が決めた範囲の外を読み書きしたら、テストの誤りとして失敗にする。

import { CPU65C02, OPCODES } from '../src/cpu65c02.js';
import { MSYM } from './basic_harness.js';

const MON_RET = MSYM.MON_RET;
const hex = (v, n) => v.toString(16).toUpperCase().padStart(n, '0');
const MODE_LEN = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, izx: 2, izy: 2, izp: 2, abs: 3, abx: 3, aby: 3, ind: 3, aix: 3, rel: 2, zpr: 3 };
const opc = (name, mode) => {
  const k = OPCODES.findIndex((o) => o.name === name && o.mode === mode);
  if (k < 0) throw new Error(`${name} ${mode}`);
  return k;
};

// ---- 命令の種類 ----
const READS = new Set(['LDA', 'LDX', 'LDY', 'ADC', 'SBC', 'AND', 'ORA', 'EOR', 'CMP', 'CPX', 'CPY', 'BIT']);
const WRITES = new Set(['STA', 'STX', 'STY', 'STZ', 'INC', 'DEC', 'ASL', 'LSR', 'ROL', 'ROR', 'TSB', 'TRB', 'RMB', 'SMB']);
const IMPLIED = new Set(['NOP', 'CLC', 'SEC', 'CLD', 'SED', 'CLI', 'SEI', 'CLV', 'TAX', 'TXA', 'TAY', 'TYA', 'TSX', 'INX', 'DEX', 'INY', 'DEY',
  'INC', 'DEC', 'ASL', 'LSR', 'ROL', 'ROR']);
// そのレジスタを変える命令(ループの中では、数えるレジスタを変えない)
const CHANGES = {
  X: new Set(['LDX', 'TAX', 'TSX', 'INX', 'DEX', 'PLX']),
  Y: new Set(['LDY', 'TAY', 'INY', 'DEY', 'PLY']),
};
const ENTRIES = OPCODES.map((o, code) => ({ code, name: o.name, mode: o.mode }))
  .filter((e) => MODE_LEN[e.mode] && e.mode !== 'rel' && e.mode !== 'zpr');
const pickFrom = (mode, pred) => ENTRIES.filter((e) => e.mode === mode && pred(e));
const SIMPLE = {
  imp: pickFrom('imp', (e) => IMPLIED.has(e.name)).concat(pickFrom('acc', (e) => IMPLIED.has(e.name))),
  imm: pickFrom('imm', () => true),
};
for (const m of ['zp', 'abs', 'abx', 'aby', 'zpx', 'zpy', 'izx', 'izy', 'izp']) SIMPLE[m] = pickFrom(m, (e) => READS.has(e.name) || WRITES.has(e.name));
const isWrite = (e) => WRITES.has(e.name);

class TestBug extends Error {}
class Unpredictable extends Error {}

// ---- プログラムを作る ----
// 命令は「セル」の配列。セルは数か、ラベルを指すもの { lab, kind }(kind: lo hi lo1 hi1 rel)。
// 項目は命令の配列(分岐の行き先は項目の頭だけ)
function makeProgram(r, W) {
  const zpRead = () => r.int(0, 0x7f);
  const zpWrite = () => r.pick([r.int(0, 0x3f), r.int(0x50, 0x7f)]);
  const slot = () => 0x40 + 2 * r.int(0, 7);
  const ld = (reg, v) => [opc(reg === 'X' ? 'LDX' : 'LDY', 'imm'), v];
  let tables = 0;   // ジャンプ表(W..W+7)の使った数
  const table = [];

  // 単純な命令(分岐しない、スタックを使わない)。項目の中の命令の配列を返す
  // keep: ループで数えているレジスタ('X'、'Y' か null)
  function simple(keep) {
    const ok = (e) => !(keep && CHANGES[keep].has(e.name));
    for (;;) {
      const mode = r.pick(['imp', 'imp', 'imm', 'imm', 'zp', 'zp', 'abs', 'abx', 'aby', 'zpx', 'zpy', 'izx', 'izy', 'izp']);
      if ((mode === 'zpx' || mode === 'izx') && keep === 'X') continue;
      if (mode === 'zpy' && keep === 'Y') continue;
      const list = SIMPLE[mode].filter(ok);
      if (!list.length) continue;
      const e = r.pick(list);
      const w = isWrite(e);
      switch (mode) {
        case 'imp': return [[e.code]];
        case 'imm': return [[e.code, r.int(0, 255)]];
        case 'zp': return [[e.code, w ? zpWrite() : zpRead()]];
        case 'abs': { const a = W + (w ? r.int(8, 511) : r.int(0, 511)); return [[e.code, a & 0xff, a >> 8]]; }
        case 'abx': case 'aby': { const a = W + r.int(8, 255); return [[e.code, a & 0xff, a >> 8]]; }
        case 'zpx': case 'zpy': {
          const n = r.int(0, 255);
          return [ld(mode === 'zpx' ? 'X' : 'Y', n), [e.code, ((w ? zpWrite() : zpRead()) - n) & 0xff]];
        }
        case 'izx': { const n = r.int(0, 255); return [ld('X', n), [e.code, (slot() - n) & 0xff]]; }
        default: return [[e.code, slot()]];   // izy、izp
      }
    }
  }
  // スタックに積んで、項目の中で戻す
  function stacked(keep) {
    const pairs = [['PHA', 'PLA'], ['PHX', 'PLX'], ['PHY', 'PLY'], ['PHP', 'PLP'], ['PHA', 'PLX'], ['PHX', 'PLY'], ['PHY', 'PLA'], ['PHP', 'PLA']]
      .filter(([, pl]) => !(keep && CHANGES[keep].has(pl)));
    const [ph, pl] = r.pick(pairs);
    const inner = r.chance(0.6) ? simple(keep) : [];
    return [[opc(ph, 'imp')], ...inner, [opc(pl, 'imp')]];
  }
  const plain = (keep) => (r.chance(0.2) ? stacked(keep) : simple(keep));

  // サブルーチン(後ろのサブルーチンだけを呼べる)
  const nsub = r.int(0, 3);
  const subs = [];
  for (let k = nsub - 1; k >= 0; k--) {
    const items = [];
    for (let n = r.int(1, 4); n > 0; n--) {
      if (k < nsub - 1 && r.chance(0.2)) {
        const s = 's' + r.int(k + 1, nsub - 1);
        items.push([[opc('JSR', 'abs'), { lab: s, kind: 'lo' }, { lab: s, kind: 'hi' }]]);
      } else items.push(plain(null));
    }
    items.push([[opc('RTS', 'imp')]]);
    subs[k] = items;
  }

  // メイン
  const main = [];
  const nmain = r.int(3, 12);
  // 前へ進む分岐の行き先: いまの項目から1〜3つ先の項目の頭(メインを過ぎたら終わり方の頭。assemble がラベルを付ける)
  const fwd = () => 'm' + (main.length + r.int(1, 3));
  for (let i = 0; i < nmain; i++) {
    const kind = r.int(0, 19);
    if (kind < 6) main.push(plain(null));
    else if (kind < 9) { // 条件分岐、BRA
      const b = r.pick(['BPL', 'BMI', 'BVC', 'BVS', 'BCC', 'BCS', 'BNE', 'BEQ', 'BRA']);
      main.push([[opc(b, 'rel'), { lab: fwd(), kind: 'rel' }]]);
    } else if (kind < 11) { // BBR、BBS
      const code = r.pick([0x0f, 0x8f]) + 16 * r.int(0, 7);
      main.push([[code, zpRead(), { lab: fwd(), kind: 'rel' }]]);
    } else if (kind < 13) { // JMP、JMP (表)、JMP (表,X)
      const t = fwd();
      const how = tables < 4 ? r.int(0, 2) : 0;
      if (how === 0) main.push([[opc('JMP', 'abs'), { lab: t, kind: 'lo' }, { lab: t, kind: 'hi' }]]);
      else {
        const at = W + 2 * tables++;
        table.push({ at, lab: t });
        if (how === 1) main.push([[opc('JMP', 'ind'), at & 0xff, at >> 8]]);
        else {
          const n = r.int(0, 255);
          const base = (at - n) & 0xffff;
          main.push([ld('X', n), [opc('JMP', 'aix'), base & 0xff, base >> 8]]);
        }
      }
    } else if (kind < 15) { // RTS か RTI で前へ(積んだ番地へ)
      const t = fwd();
      if (r.chance(0.5)) main.push([[opc('LDA', 'imm'), { lab: t, kind: 'hi1' }], [opc('PHA', 'imp')], [opc('LDA', 'imm'), { lab: t, kind: 'lo1' }], [opc('PHA', 'imp')], [opc('RTS', 'imp')]]);
      else main.push([[opc('LDA', 'imm'), { lab: t, kind: 'hi' }], [opc('PHA', 'imp')], [opc('LDA', 'imm'), { lab: t, kind: 'lo' }], [opc('PHA', 'imp')], [opc('PHP', 'imp')], [opc('RTI', 'imp')]]);
    } else if (kind < 17 && nsub) { // JSR
      const s = 's' + r.int(0, nsub - 1);
      main.push([[opc('JSR', 'abs'), { lab: s, kind: 'lo' }, { lab: s, kind: 'hi' }]]);
    } else if (kind < 19) { // ループ
      const reg = r.pick(['X', 'Y']);
      const lab = 'L' + i;
      const body = [];
      for (let n = r.int(1, 3); n > 0; n--) body.push(...plain(reg));
      const de = opc(reg === 'X' ? 'DEX' : 'DEY', 'imp');
      main.push([ld(reg, r.int(1, 5))]);
      // ループの本体は次の項目(ラベル L は BNE だけが使う)
      main.push({ lab, ins: [...body, [de], [opc('BNE', 'rel'), { lab, kind: 'rel' }]] });
    } else main.push(plain(null));
  }
  // 終わり方
  const end = r.int(0, 9);
  const ends = [];
  if (end < 5) ends.push([[opc('RTS', 'imp')]]);
  else if (end < 7) ends.push([[0x00, r.int(0, 255)]]);
  else {
    ends.push([[opc('SEI', 'imp')]]);
    ends.push({ lab: 'self', ins: [r.chance(0.5) ? [opc('JMP', 'abs'), { lab: 'self', kind: 'lo' }, { lab: 'self', kind: 'hi' }] : [opc('BRA', 'rel'), { lab: 'self', kind: 'rel' }]], self: true });
  }
  return { main, ends, subs, table };
}

// 番地を決めてバイトにする。starts は命令の頭の番地、selfAt は自分へのジャンプの番地
function assemble(prog, C) {
  const items = [];   // { labels, ins, self }
  const norm = (it) => (Array.isArray(it) ? { ins: it } : it);
  // メインの項目に 'm' + 番号のラベル
  prog.main.forEach((it, k) => { const n = norm(it); items.push({ labels: ['m' + k, ...(n.lab ? [n.lab] : [])], ins: n.ins, self: n.self }); });
  // メインを過ぎた分岐先は、終わり方の頭にする
  const endLabels = [];
  for (let k = prog.main.length; k <= prog.main.length + 3; k++) endLabels.push('m' + k);
  prog.ends.forEach((it, k) => { const n = norm(it); items.push({ labels: [...(k === 0 ? endLabels : []), ...(n.lab ? [n.lab] : [])], ins: n.ins, self: n.self }); });
  prog.subs.forEach((sub, s) => sub.forEach((it, k) => { const n = norm(it); items.push({ labels: k === 0 ? ['s' + s] : [], ins: n.ins }); }));
  // 番地
  const lab = {};
  const starts = [];
  let selfAt = null;
  let a = C;
  for (const it of items) {
    for (const l of it.labels) lab[l] = a;
    for (const ins of it.ins) { starts.push(a); if (it.self) selfAt = a; a += ins.length; }
  }
  const bytes = [];
  a = C;
  for (const it of items) {
    for (const ins of it.ins) {
      ins.forEach((c, j) => {
        if (typeof c === 'number') { bytes.push(c); return; }
        const t = lab[c.lab];
        if (t === undefined) throw new TestBug('label ' + c.lab);
        switch (c.kind) {
          case 'lo': bytes.push(t & 0xff); break;
          case 'hi': bytes.push(t >> 8); break;
          case 'lo1': bytes.push((t - 1) & 0xff); break;
          case 'hi1': bytes.push(((t - 1) >> 8) & 0xff); break;
          default: {   // rel: この命令の次の番地から
            const d = t - (a + ins.length);
            if (d < -128 || d > 127) throw new TestBug('branch out of range');
            bytes.push(d & 0xff);
          }
        }
      });
      a += ins.length;
    }
  }
  return { bytes, starts, selfAt, lab };
}

// ---- 写し ----
// mem: test/fuzz_mon.js の写しのメモリ(書き換える)。regs: 表示から分かっているレジスタ
export class RunModel {
  constructor(mem, C, len, W, starts, selfAt) {
    this.mem = mem; this.C = C; this.len = len; this.W = W;
    this.starts = new Set(starts); this.selfAt = selfAt;
    this.known = new Set();   // 値の分かっているスタックの番地(写しが積んだもの)
    this.fetch = [0, 0];
    const self = this;
    this.cpu = new CPU65C02({
      read(a) { self.check(a, false); return a < 0x8000 ? mem[a] : 0xff; },
      write(a, v) { self.check(a, true); mem[a] = v; },
    });
  }
  check(a, w) {
    if (!w && a >= this.fetch[0] && a < this.fetch[1]) return;
    if (a >= 0x100 && a <= 0x1ff) {
      if (w) this.known.add(a);
      else if (!this.known.has(a)) throw new Unpredictable(`stack $${hex(a, 4)}`);
      return;
    }
    const W = this.W;
    const ok = w ? (a <= 0x7f && !(a >= 0x40 && a <= 0x4f)) || (a >= W + 8 && a <= W + 511)
      : a <= 0x7f || (a >= W && a <= W + 511);
    if (!ok) throw new TestBug(`${w ? 'write' : 'read'} $${hex(a, 4)} at $${hex(this.cpu.pc, 4)}`);
  }
  // 状態を保存・復元(打たないことにしたとき)
  save() { const c = this.cpu; return { mem: this.mem.slice(0, 0x8000), known: new Set(this.known), cpu: [c.a, c.x, c.y, c.s, c.p, c.pc], fresh: this.fresh, rpc: this.rpc }; }
  restore(st) { this.mem.set(st.mem); this.known = st.known; const c = this.cpu; [c.a, c.x, c.y, c.s, c.p, c.pc] = st.cpu; this.fresh = st.fresh; this.rpc = st.rpc; }
  setRegs(regs, fresh) {
    const c = this.cpu;
    c.a = regs.a; c.x = regs.x; c.y = regs.y; c.s = regs.s; c.p = regs.p | 0x30; c.pc = regs.pc;
    this.fresh = fresh;
    this.rpc = regs.pc;
  }
  // 実行を始める(モニターの resume): 新しく始めるなら、モニターへの戻り番地を積む
  resume() {
    this.rpc = this.cpu.pc;
    if (this.fresh) { this.cpu.push((MON_RET - 1) >> 8); this.cpu.push((MON_RET - 1) & 0xff); this.fresh = false; }
  }
  // 1命令。止まる出来事('brk' 'rts' 'loop')か null を返す
  one() {
    const c = this.cpu, pc = c.pc;
    if (!this.starts.has(pc)) throw new TestBug(`ran into $${hex(pc, 4)}`);
    const op = this.mem[pc];
    if (op === 0x00) { c.pc = (pc + 2) & 0xffff; return 'brk'; }
    this.fetch = [pc, pc + MODE_LEN[OPCODES[op].mode]];
    c.step();
    this.fetch = [0, 0];
    if (c.pc === MON_RET) return 'rts';
    if (c.pc === pc) return 'loop';
    return null;
  }
  // G(cont: 番地なし)。bps: ブレークポイントの番地の配列
  go(bps) {
    const c = this.cpu;
    const bp = new Set(bps);
    this.resume();
    let n = 0;
    if (bp.has(c.pc)) {   // ブレークポイントの上からは、1命令(T と同じ)進めてから
      const ev = this.one();
      if (ev === 'loop') throw new Unpredictable('G from a breakpoint on a loop');
      if (ev) return this.stop(ev);
      this.rpc = c.pc;
    }
    for (;;) {
      if (bp.has(c.pc)) return this.stop('bp');
      const ev = this.one();
      if (ev === 'loop') return this.stop('break');
      if (ev) return this.stop(ev);
      if (++n > 50000) throw new TestBug('the model did not stop');
    }
  }
  // T か P を count 回。途中で予想できない命令に来たら、そこまでの回数を done に入れて Unpredictable
  step(over, count) {
    const c = this.cpu;
    for (let k = 0; k < count; k++) {
      this.resume();
      const pc = c.pc;
      if (pc === this.selfAt) { this.done = k; throw new Unpredictable('stepping a loop to itself'); }
      if (this.mem[pc] === 0x20 && over) {   // P の JSR: 戻るまで(JSR の次の命令まで)
        let n = 0;
        let ev = this.one();
        while (!ev && c.pc !== pc + 3) { ev = this.one(); if (++n > 50000) throw new TestBug('the model did not return'); }
        if (ev) throw new TestBug('stopped inside a subroutine');
        continue;
      }
      let ev;
      try { ev = this.one(); } catch (e) { if (e instanceof Unpredictable) this.done = k; throw e; }
      if (ev === 'loop') throw new TestBug('loop while stepping');
      if (ev) return this.stop(ev);
    }
    return this.stop('step');
  }
  // 止まったときの表示。B は BREAK キーのときだけ0(ほかは BRK でモニターに戻るので1)
  stop(ev) {
    const c = this.cpu;
    if (ev === 'rts') this.fresh = true;
    const p = ev === 'break' ? (c.p & ~0x10) | 0x20 : c.p | 0x30;
    const pc = ev === 'rts' ? this.rpc : c.pc;
    return { ev, a: c.a, x: c.x, y: c.y, s: c.s, p, pc };
  }
}

const flags = (p) => [...'NV-BDIZC'].map((ch, k) => (k === 2 ? '-' : (p & (0x80 >> k) ? ch : '.'))).join('');
export const regsText = (st) => `A=${hex(st.a, 2)} X=${hex(st.x, 2)} Y=${hex(st.y, 2)}\nS=${hex(st.s, 2)} P=${flags(st.p)}` + (st.ev === 'rts' ? '' : `\n${hex(st.pc, 4)} `);

// ---- プログラムと、その準備の行を作る ----
// 返すもの: C(コードの番地)、W(データの番地)、prog、asm、lines(打つ行 { text, apply(write) }。apply は写しのメモリに書く)
export function prepare(r) {
  // 場所: コードは書いてよい範囲のどこか、データは $2000-$6FFF の 512 バイト
  let C, W, prog, asm;
  for (let tries = 0; ; tries++) {
    if (tries > 20) throw new TestBug('cannot make a program');
    W = r.int(0x2000, 0x6fff - 511);
    C = r.chance(0.3) ? r.int(0x0590, 0x0700) : r.int(0x2010, 0x6f00);
    prog = makeProgram(r, W);
    try { asm = assemble(prog, C); } catch (e) { if (e instanceof TestBug) continue; throw e; }
    const end = C + asm.bytes.length;
    if (end > (C < 0x800 ? 0x7f0 : 0x6ff0)) continue;
    if (C < W + 512 && end > W) continue;   // 重ならない
    break;
  }
  // 書き込む: データ、ゼロページ、ポインタ、ジャンプ表、プログラム
  const lines = [];
  const vals = Array.from({ length: r.int(1, 4) }, () => r.int(0, 255));
  lines.push({ text: `F ${hex(W, 4)} ${hex(W + 511, 4)} ${vals.map((v) => hex(v, 2)).join(' ')}`, apply: (write) => { for (let j = 0; j < 512; j++) write(W + j, vals[j % vals.length]); } });
  for (const [lo, hi] of [[0x00, 0x3f], [0x50, 0x7f]]) {
    const zv = Array.from({ length: r.int(1, 4) }, () => r.int(0, 255));
    lines.push({ text: `F ${hex(lo, 2)} ${hex(hi, 2)} ${zv.map((v) => hex(v, 2)).join(' ')}`, apply: (write) => { for (let j = lo; j <= hi; j++) write(j, zv[(j - lo) % zv.length]); } });
  }
  const ptrs = [];
  for (let k = 0; k < 8; k++) { const p = W + r.int(8, 255); ptrs.push(p & 0xff, p >> 8); }
  const jt = Array.from({ length: 8 }, () => r.int(0, 255));
  for (const t of prog.table) { const v = asm.lab[t.lab]; jt[t.at - W] = v & 0xff; jt[t.at - W + 1] = v >> 8; }
  const eLines = (at, bytes) => {
    for (let off = 0; off < bytes.length; off += 16) {
      const part = bytes.slice(off, off + 16);
      lines.push({ text: `E ${hex(at + off, 4)} ${part.map((v) => hex(v, 2)).join(' ')}`, apply: (write) => part.forEach((v, j) => write(at + off + j, v)) });
    }
  };
  eLines(0x40, ptrs);
  eLines(W, jt);
  eLines(C, asm.bytes);
  return { C, W, prog, asm, lines };
}

// ---- 1つの場面 ----
// ctx: { r, b, run, expectBody, bodyOf, compareMem, write, mem, regs, bps, bpList, exec, fail, typed, hexText, caseRand, isFailed }
export function runScenario(ctx) {
  const { r, b, mem, regs, bps } = ctx;
  const { C, W, asm, lines } = prepare(r);
  const len = asm.bytes.length;
  const inCode = (a) => a >= C && a < C + len;
  const inData = (a) => (a >= W && a <= W + 511) || a <= 0x7f;

  // 前のブレークポイントのうち、プログラムやデータを壊すものを消す
  // (命令の頭のものは残す。自分へのジャンプの上は除く。G で進まなくなるため)。
  // $00E0-$057F には置けない(B23-01)ので、ここにはない
  for (const a of bps.filter((v) => v !== null)) {
    const harmless = (a >= 0x80 && a <= 0xdf) || (a >= 0x580 && !inCode(a) && !inData(a)) || (asm.starts.includes(a) && a !== asm.selfAt);
    if (harmless) continue;
    bps[bps.indexOf(a)] = null;
    if (ctx.expectBody('B - ' + hex(a, 4), ctx.bpList(), 'B (before run)') === null) return;
  }

  // 書き込む: データ、ゼロページ、ポインタ、ジャンプ表、プログラム
  for (const l of lines) {
    l.apply(ctx.write);
    if (ctx.expectBody(l.text, '', 'E/F for run') === null) return;
  }
  if (!ctx.compareMem('writing the program')) return;
  ctx.typed.push(`  (program at ${hex(C, 4)}-${hex(C + len - 1, 4)}, data ${hex(W, 4)}, starts ${asm.starts.map((v) => hex(v, 4)).join(' ')})`);

  const model = new RunModel(mem, C, len, W, asm.starts, asm.selfAt);
  const bpCandidates = asm.starts.filter((a) => a !== asm.selfAt);
  const live = () => bps.filter((v) => v !== null);

  // 打って、表示を写しと比べる。st は写しの止まったときの状態
  const check = (line, out, st) => {
    const got = ctx.bodyOf(out, line);
    const want = regsText(st);
    const ok = st.ev === 'rts' ? got === want : got.startsWith(want);
    if (!ok) { ctx.fail(`${line.split(' ')[0].toUpperCase()}: unexpected registers (${st.ev})`, `got ${JSON.stringify(got)}\nwant ${JSON.stringify(want)}${st.ev === 'rts' ? '' : '...'}`); return false; }
    Object.assign(regs, { a: st.a, x: st.x, y: st.y, s: st.s, p: st.p, pc: st.pc });
    ctx.exec.fresh = model.fresh;
    return ctx.compareMem(line);
  };
  // 写しで先に動かしてみる。予想できなければ null(写しは元のまま)
  const predict = (fn) => {
    const saved = model.save();
    try { return fn(); } catch (e) {
      model.restore(saved);
      if (e instanceof Unpredictable) return null;
      throw e;
    }
  };
  // G の後: 止まるか、自分へのジャンプで回り続ける(BREAK キーを押す)
  const doGo = (line, st) => {
    if (st.ev === 'break') {
      ctx.typed.push(line + '   (then BREAK)');
      const out = b.run(line, 30);
      if (!out.endsWith('(timeout)')) { ctx.fail('G: stopped by itself (want a loop)', JSON.stringify(out)); return false; }
      b.m.pressBreak();
      b.clearOut();
      if (!b.settle(600)) { ctx.fail('BREAK did not stop the program'); return false; }
      return check('', b.out.replace(/^\n/, ''), st);
    }
    const out = ctx.run(line);
    if (out === null) return false;
    return check(line, out, st);
  };

  // 始め方: G 番地(ブレークポイントを置いてから)か、R PC と R S を決めて T・P
  let ended = false;
  if (r.chance(0.7)) {
    for (let n = r.int(0, 2); n > 0; n--) {
      const a = r.pick(bpCandidates);
      if (bps.includes(a)) continue;
      let f = bps.indexOf(null);
      if (f < 0) {   // 空きがなければ、プログラムの外のものを1つ消す
        const other = live().find((v) => !asm.starts.includes(v));
        if (other === undefined) break;
        bps[bps.indexOf(other)] = null;
        if (ctx.expectBody('B - ' + hex(other, 4), ctx.bpList(), 'B -') === null) return;
        f = bps.indexOf(null);
      }
      bps[f] = a;
      if (ctx.expectBody(ctx.caseRand('B') + ' ' + ctx.hexText(a), ctx.bpList(), 'B') === null) return;
    }
    model.setRegs({ ...regs, s: 0xff, pc: C }, true);
    const st = model.go(live());
    if (!doGo(ctx.caseRand('G') + ' ' + ctx.hexText(C), st)) return;
    ended = st.ev !== 'bp';
  } else {
    const s = r.int(0x80, 0xff);
    if (ctx.expectBody(`R PC ${ctx.hexText(C)}`, '', 'R PC') === null) return;
    if (ctx.expectBody(`R S ${ctx.hexText(s)}`, '', 'R S') === null) return;
    regs.pc = C; regs.s = s;
    model.setRegs(regs, ctx.exec.fresh);
  }

  // 続き: T・P・G・B
  for (let k = r.int(2, 9); k > 0 && !ended && !ctx.isFailed(); k--) {
    const what = r.int(0, 9);
    if (what < 6) { // T か P
      const over = what >= 4;
      const n = r.pick([1, r.int(2, 8), r.int(9, 40)]);
      let st = predict(() => model.step(over, n));
      let cnt = n;
      if (st === null) {
        cnt = model.done ?? 0;
        if (!cnt) break;   // 次の命令は1つも進められない
        st = predict(() => model.step(over, cnt));
        if (st === null) throw new TestBug('step prediction changed');
      }
      const letter = ctx.caseRand(over ? 'P' : 'T');
      const line = cnt === 1 && r.chance(0.5) ? letter : `${letter} ${ctx.hexText(cnt)}`;
      const out = ctx.run(line);
      if (out === null || !check(line, out, st)) return;
      ended = st.ev === 'rts' || st.ev === 'brk';
    } else if (what < 8) { // G(続きから)
      const st = predict(() => model.go(live()));
      if (st === null) break;
      if (!doGo(ctx.caseRand('G'), st)) return;
      ended = st.ev !== 'bp';
    } else { // ブレークポイントを置く・消す
      const here = live().filter((v) => asm.starts.includes(v));
      if (here.length && r.chance(0.5)) {
        const a = r.pick(here);
        bps[bps.indexOf(a)] = null;
        if (ctx.expectBody(ctx.caseRand('B') + ' - ' + ctx.hexText(a), ctx.bpList(), 'B -') === null) return;
      } else {
        const a = r.pick(bpCandidates);
        const f = bps.indexOf(null);
        if (bps.includes(a) || f < 0) continue;
        bps[f] = a;
        if (ctx.expectBody(ctx.caseRand('B') + ' ' + ctx.hexText(a), ctx.bpList(), 'B') === null) return;
      }
    }
  }
}

export { TestBug, Unpredictable };
