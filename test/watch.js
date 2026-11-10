// 実行時の見張りとカバレッジの記録(テスト用)
//
//   import { watchMachine } from './watch.js';
//   watchMachine(m, PROFILE_PX65(rom));   // m は Machine。テストで ROM を動かす前に呼ぶ
//
// ROM のコードが「してはいけないこと」をしたら記録し、テストのプロセスが終わるときに
// WATCH の行で表示して、終了コードを1にする(同じ命令の同じ種類の違反は1行にまとめる)。
//
// 見張ること:
//   exec      ROM の中で、命令の頭でない番地(命令の途中やデータ)を実行した
//   brk       ROM の中で BRK、STP、未定義の命令を実行した
//   write     ROM のコードが、自分の持ち物でない RAM に書いた(下の OWN)。
//             ROM・未使用の番地・未定義の I/O への書き込みも
//   leave     ROM から、RTS・RTI 以外で ROM の外へ飛んだ(CALL などの許した場所を除く)
//
// 違反は、テストのプロセスが終わるときにまとめて表示する。
//   stack     スタックポインタが一周した(押しすぎ・引きすぎ)
//   memory    BASIC が入力を待っているときに、プログラムのつなぎや vartab などの記録が合わない
//             (checkBasicMemory。test/basic_harness.js が呼ぶ)
//
// 環境変数 PX65_COVERAGE にファイル名を入れると、実行した番地と、条件分岐の向きを
// そのファイルに足し込む(tools/coverage.js が使う)。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { OPCODES } from '../src/cpu65c02.js';

// ---- RAM の持ち物(docs/basic.md と docs/monitor.md の「メモリの使い方」) ----
// 書いてよい I/O($8001 は読み出し専用)。BASIC はキーの行($8000)とテープのデータ($8030)を直接は書かない
// (キーは BIOS が読み、テープは BIOS が読み書きする)
const IO_REGS = {
  basic: [0x8002, 0x8003, 0x8010, 0x8020, 0x8031],
  monitor: [0x8000, 0x8002, 0x8003, 0x8010, 0x8020, 0x8030, 0x8031],
};
const OWN = {
  // $07FF: BASIC はプログラムの直前に0を置く(RUN と RESTORE がここから読み始める)
  basic: [[0x80, 0xdf], [0x100, 0x1ff], [0x2c6, 0x2ff], [0x300, 0x3ff], [0x400, 0x57f], [0x7ff, 0x7fff]],
  monitor: [[0xe0, 0xff], [0x100, 0x1ff], [0x200, 0x2c5], [0x300, 0x37f], [0x400, 0x57f]],
};

// px65.inc で公開している $0200-$03FF の番地(BIOS に渡す値と RAM ベクタ)は、だれが書いてもよい
const PUBLIC = new Uint8Array(0x10000);
for (const line of readFileSync(new URL('../rom/px65.inc', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^(\w+)\s*=\s*\$([0-9A-F]{4})\b\s*(?:;\s*(\d+)(?![\d$]))?/i);
  if (!m) continue;
  const addr = parseInt(m[2], 16);
  if (addr < 0x200 || addr > 0x3ff) continue;
  // ベクタは2バイト
  const size = /VEC$/i.test(m[1]) ? 2 : Math.max(1, Number(m[3] ?? 1));
  for (let k = 0; k < size; k++) PUBLIC[addr + k] = 1;
}

// 使う人が指定した番地に書く・飛ぶ命令。ラベルから次のラベルまでの範囲で許す。
// what は 'write'(書いてよい)か 'leave'(ROM の外へ飛んでよい)。
// 'write' は、範囲の中でも番地をポインタや添字で決める命令(INDIRECT_MODES)の書き込みだけを許す
// (同じ範囲にある、ゼロページの変数などへの直接の書き込みはふつうに調べる)。
// dest があれば、書き込み先もその範囲に限る
const EXEMPT = [
  { region: 'basic', label: 'st_poke', what: 'write', why: 'POKE' },
  { region: 'basic', label: 'st_call', what: 'leave', why: 'CALL' },
  { region: 'monitor', label: 'cold_clr', what: 'write', why: '電源投入で $0200-$02FF を0にする', dest: [0x200, 0x2ff] },
  { region: 'monitor', label: 'e_wr', what: 'write', why: 'E(1バイトずつ)' },
  { region: 'monitor', label: 'e_store', what: 'write', why: 'E' },
  { region: 'monitor', label: 'f_1', what: 'write', why: 'F' },
  { region: 'monitor', label: 'm_fwd', what: 'write', why: 'M(前から)' },
  { region: 'monitor', label: 'm_b1', what: 'write', why: 'M(後ろから)' },
  { region: 'monitor', label: 'ib_1', what: 'write', why: 'ブレークポイントの BRK' },
  { region: 'monitor', label: 'it_1', what: 'write', why: '一時ブレークポイントの BRK' },
  { region: 'monitor', label: 'rb_1', what: 'write', why: 'BRK を元に戻す' },
  { region: 'monitor', label: 'rb_3', what: 'write', why: 'BRK を元に戻す' },
  { region: 'monitor', label: 'tl_1', what: 'write', why: 'テープのデータを T_START から読む' },
  { region: 'monitor', label: 'ao_w1', what: 'write', why: 'A(アセンブル)の書き込み' },
];

const BRANCH_MODES = new Set(['rel', 'zpr']);
// 書き込み先をポインタや添字で決めるアドレッシング((zp),Y (zp) (zp,X) abs,X abs,Y zp,X zp,Y)
const INDIRECT_MODES = new Set(['izy', 'izp', 'izx', 'abx', 'aby', 'zpx', 'zpy']);

// ---- プロファイル(どの ROM を動かしているか) ----

// 組み込みの ROM(BASIC + モニター)。rom は tools/rom.js の buildRom() の結果
export function PROFILE_PX65(rom) {
  return makeProfile('px65', [
    { region: 'basic', lo: 0xa000, hi: 0xdfff, asm: rom.basic },
    { region: 'monitor', lo: 0xe000, hi: 0xffff, asm: rom.monitor },
  ]);
}

// モニターだけの ROM。asm は rom/monitor.s をアセンブルした結果
export function PROFILE_MONITOR(asm) {
  return makeProfile('monitor', [
    { region: 'monitor', lo: 0xe000, hi: 0xffff, asm },
  ]);
}

// 作ったプロファイル。名前ごとに { asms, settings, prof, bytes } を覚える。
// 同じ組み立て結果(asm のオブジェクト)で、領域・範囲・除外の設定(exempt、exemptList と その dest)も
// 同じなら、作り直さずに使う。設定は作った時点の写し(JSON)と比べるので、配列を差し替えても、
// 同じ配列の中身を後から書き換えても、違いが分かる。
// カバレッジは名前ごとに合算するので、同じ名前で中身の違う ROM が来たらエラーにする
const profileCache = new Map();
const settingsOf = (parts) => JSON.stringify(parts.map((p) =>
  [p.region, p.lo, p.hi, p.exempt ?? null, p.exemptList ?? null]));
const sameAsms = (asms, parts) => asms.length === parts.length && asms.every((a, i) => a === parts[i].asm);
const romBytes = (parts) => parts.map((p) => Array.from(p.asm.mem.subarray(p.lo, p.hi + 1)).join(',') + '|' +
  p.asm.lines.filter((l) => l.code).map((l) => l.addr).join(',')).join('/');

export function makeProfile(name, parts) {
  const cached = profileCache.get(name);
  const settings = settingsOf(parts);
  if (cached && sameAsms(cached.asms, parts) && cached.settings === settings) return cached.prof;
  parts = JSON.parse(settings).map(([region, lo, hi, exempt, exemptList], i) =>
    ({ region, lo, hi, exempt: exempt ?? undefined, exemptList: exemptList ?? undefined, asm: parts[i].asm })); // 写しで作る
  const bytes = romBytes(parts);
  if (cached && cached.bytes !== bytes) throw new Error(`watch.js: profile "${name}" is already used for a different ROM`);
  const start = new Uint8Array(0x10000);       // 命令の頭なら1
  const lineAt = new Int32Array(0x10000).fill(-1); // 番地 -> lines の添字
  const lines = [];
  const regionOf = new Array(0x10000).fill(null);
  const exempt = { write: new Uint8Array(0x10000), leave: new Uint8Array(0x10000), dest: new Map() };
  const labels = []; // { addr, name }(報告用)
  for (const p of parts) {
    for (let a = p.lo; a <= p.hi; a++) regionOf[a] = p.region;
    for (const l of p.asm.lines) {
      if (l.addr < p.lo || l.addr > p.hi) continue;
      const idx = lines.push({ ...l, region: p.region }) - 1;
      for (let k = 0; k < l.len; k++) lineAt[(l.addr + k) & 0xffff] = idx;
      if (l.code) start[l.addr] = 1;
    }
    for (const [sym, v] of Object.entries(p.asm.symbols)) {
      if (v >= p.lo && v <= p.hi && start[v]) labels.push({ addr: v, name: sym.toLowerCase(), region: p.region });
    }
  }
  labels.sort((a, b) => a.addr - b.addr);
  for (const p of parts) {
    if (p.exempt === false) continue; // test/watch.test.js の小さな ROM
    for (const e of p.exemptList ?? EXEMPT) { // exemptList: test/watch.test.js が自分の一覧を渡す
      if (e.region !== p.region) continue;
      const from = p.asm.symbols[e.label.toUpperCase()];
      if (from === undefined) throw new Error(`watch.js: unknown label ${e.label}`);
      const next = labels.find((l) => l.addr > from);
      const to = next ? next.addr : p.hi + 1;
      for (let a = from; a < to; a++) {
        exempt[e.what][a] = 1;
        if (e.dest) exempt.dest.set(a, e.dest);
      }
    }
  }
  const prof = { name, parts, start, lineAt, lines, regionOf, exempt, labels };
  profileCache.set(name, { asms: parts.map((p) => p.asm), settings, prof, bytes });
  return prof;
}

// 番地を「ラベル+オフセット (ファイル:行)」で表す
export function where(prof, addr) {
  let lab = null;
  for (const l of prof.labels) { if (l.addr <= addr) lab = l; else break; }
  const li = prof.lineAt[addr];
  const src = li >= 0 ? ` ${shortFile(prof.lines[li].file)}:${prof.lines[li].no}` : '';
  const h = '$' + addr.toString(16).toUpperCase().padStart(4, '0');
  if (!lab || addr < 0xa000) return h + src;
  const off = addr - lab.addr;
  return `${h} ${lab.name}${off ? '+' + off : ''}${src}`;
}
const shortFile = (f) => f.replace(/^.*[\\/](rom[\\/])/, '$1').replace(/\\/g, '/');

// ---- 違反の記録 ----

const found = new Map(); // キー -> { kind, pc, detail, addrs }
export const violations = [];
let exitHooked = false;

// addr を渡すと、同じ命令の違反をまとめて番地の範囲で表示する
function report(prof, kind, pc, detail, addr) {
  const key = `${prof.name}|${kind}|${pc}|${detail}`;
  let v = found.get(key);
  if (!v) {
    v = { prof, kind, pc, detail, addrs: new Set() };
    found.set(key, v);
    violations.push(v);
  }
  if (addr !== undefined) v.addrs.add(addr);
  if (!exitHooked) {
    exitHooked = true;
    process.on('exit', () => {
      if (!violations.length) return;
      console.log('');
      for (const x of violations) console.log(`  WATCH ${formatViolation(x)}`);
      console.log(`${violations.length} watch violation(s) (test/watch.js)`);
      process.exitCode = 1;
    });
  }
}

// 記録した違反を取り出して消す(test/watch.test.js が、わざと起こした違反を調べるのに使う)
export function takeViolations() {
  const out = violations.splice(0).map(formatViolation);
  found.clear();
  return out;
}

export function formatViolation(v) {
  const addrs = v.addrs.size ? ' ' + ranges([...v.addrs]) : '';
  return `${v.kind}: ${where(v.prof, v.pc)}: ${v.detail}${addrs}`;
}

function ranges(list) {
  list.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < list.length;) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    out.push(i === j ? '$' + hex(list[i]) : `$${hex(list[i])}-$${hex(list[j])}`);
    i = j + 1;
  }
  return out.join(',');
}

// ---- BASIC のメモリの使い方の記録 ----
// BASIC が入力を待っているときに呼ぶ(test/basic_harness.js)。sym は BASIC のシンボル。
// プログラムのつなぎと、vartab・arytab・strend・fretop の関係が正しいかを調べ、違えば違反にする
export function checkBasicMemory(m, prof, sym) {
  const ram = m.bus.ram;
  const w = (a) => ram[a] | (ram[a + 1] << 8);
  const problems = [];
  let p = sym.PRGSTART, lastNo = -1, n = 0;
  for (;;) {
    const link = w(p);
    if (link === 0) break;
    const no = w(p + 2);
    let e = p + 4;
    while (e < 0x8000 && ram[e] !== 0) e++;
    if (link !== e + 1) { problems.push(`line ${no} at $${hex(p)}: link $${hex(link)} but ends at $${hex(e)}`); break; }
    if (no <= lastNo) { problems.push(`line ${no} after ${lastNo}`); break; }
    lastNo = no; p = link;
    if (++n > 10000) { problems.push('program does not end'); break; }
  }
  const end = p + 2;
  const vartab = w(sym.VARTAB), arytab = w(sym.ARYTAB), strend = w(sym.STREND), fretop = w(sym.FRETOP);
  if (vartab !== end) problems.push(`vartab $${hex(vartab)} but the program ends at $${hex(end)}`);
  if (!(vartab <= arytab && arytab <= strend && strend <= fretop && fretop <= sym.STRTOP)) {
    problems.push(`vartab $${hex(vartab)} arytab $${hex(arytab)} strend $${hex(strend)} fretop $${hex(fretop)}`);
  }
  if (ram[sym.PRGSTART - 1] !== 0) problems.push(`$${hex(sym.PRGSTART - 1)} is not 0`);
  for (const t of problems) report(prof, 'memory', m.cpu.pc, t);
  return problems;
}

// ---- カバレッジ ----
// 番地ごとのビット: 1 実行した、2 分岐した、4 分岐しなかった
const coverage = new Map(); // プロファイル名 -> Uint8Array(0x10000)
let coverageHooked = false;

function coverageOf(prof) {
  let c = coverage.get(prof.name);
  if (!c) {
    c = new Uint8Array(0x10000);
    coverage.set(prof.name, c);
    if (process.env.PX65_COVERAGE && !coverageHooked) {
      coverageHooked = true;
      process.on('exit', saveCoverage);
    }
  }
  return c;
}

function saveCoverage() {
  const file = process.env.PX65_COVERAGE;
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  for (const [name, c] of coverage) {
    const old = data[name] ? Buffer.from(data[name].bits, 'base64') : new Uint8Array(0x10000);
    for (let a = 0; a < 0x10000; a++) old[a] |= c[a];
    const prev = data[name]?.minS ?? 0xff;
    data[name] = { bits: Buffer.from(old).toString('base64'), minS: Math.min(prev, minStack.get(name) ?? 0xff) };
  }
  writeFileSync(file, JSON.stringify(data));
}

// プロファイルごとのスタックポインタの最小値(どこまで深くなったか)
export const minStack = new Map();

// ---- 見張りを付ける ----

export function watchMachine(m, prof) {
  const cpu = m.cpu, bus = m.bus;
  const cov = coverageOf(prof);
  m.watchCoverage = cov;
  const { start, regionOf, exempt } = prof;
  let curPc = -1;       // いま実行している命令の番地(命令でないときは -1)
  let curRegion = null;
  let curMode = null;   // いま実行している命令のアドレッシング

  const origWrite = bus.write.bind(bus);
  bus.write = (addr, v) => {
    if (curRegion !== null) checkWrite(addr);
    origWrite(addr, v);
  };
  function checkWrite(addr) {
    if (exempt.write[curPc] && INDIRECT_MODES.has(curMode)) {
      const d = exempt.dest.get(curPc);
      if (!d || (addr >= d[0] && addr <= d[1])) return;
    }
    if (addr >= 0x8000) {
      if (IO_REGS[curRegion].includes(addr)) return;
      report(prof, 'write', curPc, `writes ${addr >= 0xa000 ? 'ROM' : addr <= 0x80ff ? 'an I/O address it does not use' : 'unused area'}`, addr);
      return;
    }
    if (PUBLIC[addr]) return;
    for (const [lo, hi] of OWN[curRegion]) if (addr >= lo && addr <= hi) return;
    report(prof, 'write', curPc, `${curRegion} code writes outside its area:`, addr);
  }

  const origStep = m.step.bind(m);
  let minS = minStack.get(prof.name) ?? 0xff;
  m.step = () => {
    const pc = cpu.pc;
    const runs = !cpu.stopped && !(cpu.waiting && !cpu.nmiPending && !cpu.irq)
      && !cpu.nmiPending && !(cpu.irq && !(cpu.p & 0x04));
    if (!runs) {
      curRegion = null; curPc = -1;
      const s0 = cpu.s;
      const c = origStep();
      checkStack(s0, pc, false);
      return c;
    }
    const region = regionOf[pc];
    const op = bus.read(pc);
    const e = OPCODES[op];
    if (region !== null) {
      cov[pc] |= 1;
      if (!start[pc]) report(prof, 'exec', pc, `not the start of an instruction (opcode $${hex(op, 2)})`);
      else if (op === 0x00 || e.name === 'STP' || e.mode === 'n1' || e.mode === 'n2' || e.mode === 'n3') {
        report(prof, 'brk', pc, `executes ${e.name} ($${hex(op, 2)})`);
      }
      curPc = pc; curRegion = region; curMode = e.mode;
    } else {
      curPc = -1; curRegion = null;
    }
    const s0 = cpu.s;
    const c = origStep();
    curRegion = null;
    const npc = cpu.pc;
    if (region !== null) {
      if (BRANCH_MODES.has(e.mode) && e.name !== 'BRA') {
        const len = e.mode === 'rel' ? 2 : 3;
        cov[pc] |= npc === ((pc + len) & 0xffff) ? 4 : 2;
      }
      if (npc < 0xa000 && e.name !== 'RTS' && e.name !== 'RTI' && !exempt.leave[pc]) {
        report(prof, 'leave', pc, `${e.name} leaves ROM to`, npc);
      }
      checkStack(s0, pc, e.name === 'TXS');
    }
    return c;
  };
  function checkStack(s0, pc, txs) {
    const s1 = cpu.s;
    if (s1 < minS) { minS = s1; minStack.set(prof.name, minS); }
    if (txs) return;
    // 1命令で動くのは数バイトだけなので、大きく動いたら一周した
    const d = (s1 - s0 + 256) & 0xff;
    if (Math.abs(s1 - s0) > 8 && (d <= 8 || d >= 248)) {
      report(prof, 'stack', pc, `S wrapped $${hex(s0, 2)} -> $${hex(s1, 2)}`);

    }
  }
  return m;
}

const hex = (v, n = 4) => v.toString(16).toUpperCase().padStart(n, '0');
