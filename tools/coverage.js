// ROM のカバレッジ: テストで一度も実行されなかった命令と、片方の向きにしか進まなかった条件分岐を調べる
//
//   node tools/coverage.js            # npm test のテストを全部動かして、coverage/report.txt に書く
//   node tools/coverage.js basic      # 名前に basic を含むテストだけ動かす
//
// テストは test/watch.js の見張りを付けて動く。環境変数 PX65_COVERAGE に入れたファイルに、
// 実行した番地と分岐の向きが足し込まれるので、それをソースの行と突き合わせる。

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRom } from './rom.js';
import { assemble } from './asm.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'coverage');
const dataFile = join(outDir, 'data.json');

// ---- テストを動かす ----
const filter = process.argv[2];
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tests = [...pkg.scripts.test.matchAll(/node (test\/\S+\.test\.js)/g)].map((m) => m[1])
  .filter((t) => !filter || t.includes(filter));
mkdirSync(outDir, { recursive: true });
rmSync(dataFile, { force: true });
let failed = [];
for (const t of tests) {
  process.stdout.write(`running ${t} ... `);
  try {
    execFileSync(process.execPath, [join(root, t)], { cwd: root, env: { ...process.env, PX65_COVERAGE: dataFile }, stdio: 'pipe' });
    console.log('ok');
  } catch (err) {
    console.log('FAILED');
    failed.push(t);
  }
}
if (!existsSync(dataFile)) { console.log('no coverage data'); process.exit(1); }
const data = JSON.parse(readFileSync(dataFile, 'utf8'));

// ---- 集計 ----
const rom = buildRom();
const monAsm = assemble(readFileSync(join(root, 'rom/monitor.s'), 'utf8'), join(root, 'rom/monitor.s'));
// モニターの部分は、内蔵ROMとモニターだけのROMで機械語が同じなので、両方で実行した番地を合わせて数える
// (モニターのコマンドは、主に test/monitor.test.js がモニターだけのROMで調べている)
const same = rom.monitor.mem.subarray(0xe000).every((v, i) => v === monAsm.mem[0xe000 + i]);
const bitsOf = (name) => data[name] ? Buffer.from(data[name].bits, 'base64') : new Uint8Array(0x10000);
const union = (...names) => { const u = new Uint8Array(0x10000); for (const n of names) bitsOf(n).forEach((v, i) => { u[i] |= v; }); return u; };
const PROFILES = same ? {
  all: { title: '内蔵ROM(モニターの部分は、モニターだけのROMで動かした分も合わせる)', minS: ['px65', 'monitor'],
    parts: [[rom.basic, 0xa000, 0xdfff, bitsOf('px65')], [rom.monitor, 0xe000, 0xffff, union('px65', 'monitor')]] },
} : {
  px65: { title: '内蔵ROM(BASIC + モニター)', minS: ['px65'], parts: [[rom.basic, 0xa000, 0xdfff, bitsOf('px65')], [rom.monitor, 0xe000, 0xffff, bitsOf('px65')]] },
  monitor: { title: 'モニターだけのROM', minS: ['monitor'], parts: [[monAsm, 0xe000, 0xffff, bitsOf('monitor')]] },
};

const BRANCH = /^\s*(?:[\w.@]+:\s*)?(bcc|bcs|beq|bne|bmi|bpl|bvc|bvs|bbr\d|bbs\d)\b/i;
const out = [];
const summary = [];
for (const [name, prof] of Object.entries(PROFILES)) {
  for (const n of prof.minS) {
    if (!data[n]) continue;
    out.push(`スタックの最も深いところ(${n}): S = $${data[n].minS.toString(16).toUpperCase().padStart(2, '0')}(${0xff - data[n].minS} バイト使用)`);
  }
  out.unshift(`==== ${prof.title} ====`);
  out.push('');
  // ファイルごとに行を集める
  const files = new Map();
  for (const [asm, lo, hi, bits] of prof.parts) {
    const srcCache = new Map();
    // 行の頭のラベル(報告用)
    for (const l of asm.lines) {
      if (!l.code || l.addr < lo || l.addr > hi) continue;
      if (!srcCache.has(l.file)) srcCache.set(l.file, readFileSync(l.file, 'utf8').split(/\r?\n/));
      const text = srcCache.get(l.file)[l.no - 1];
      const f = relative(root, l.file).replace(/\\/g, '/');
      if (!files.has(f)) files.set(f, { lines: [], text: srcCache.get(l.file) });
      const b = bits[l.addr];
      files.get(f).lines.push({ no: l.no, addr: l.addr, run: (b & 1) !== 0,
        branch: BRANCH.test(text), taken: (b & 2) !== 0, fell: (b & 4) !== 0 });
    }
  }
  const rows = [];
  let tot = { lines: 0, run: 0, br: 0, both: 0 };
  const detail = [];
  for (const [f, { lines, text }] of files) {
    lines.sort((a, b) => a.no - b.no);
    const run = lines.filter((l) => l.run).length;
    const brs = lines.filter((l) => l.branch && l.run);
    const both = brs.filter((l) => l.taken && l.fell).length;
    tot.lines += lines.length; tot.run += run; tot.br += lines.filter((l) => l.branch).length; tot.both += both;
    rows.push(`  ${f.padEnd(20)} 命令 ${pct(run, lines.length)} (${lines.length - run} 行が未実行)   分岐 ${pct(both, lines.filter((l) => l.branch).length)} が両方向`);
    // 未実行の行をかたまりにする
    detail.push(`---- ${f} ----`);
    const labelOf = (no) => {
      for (let n = no - 1; n >= 0; n--) {
        const m = /^([\w.@]+):/.exec(text[n]);
        if (m) return m[1];
      }
      return '';
    };
    for (let i = 0; i < lines.length;) {
      if (lines[i].run) { i++; continue; }
      let j = i;
      while (j + 1 < lines.length && !lines[j + 1].run) j++;
      const a = lines[i], b = lines[j];
      detail.push(`  未実行 ${f}:${a.no}${b.no !== a.no ? '-' + b.no : ''}  (${labelOf(a.no)}, ${j - i + 1} 命令)`);
      i = j + 1;
    }
    for (const l of lines) {
      if (!l.branch || !l.run || (l.taken && l.fell)) continue;
      detail.push(`  分岐   ${f}:${l.no}  (${labelOf(l.no)}) ${l.taken ? 'いつも分岐した' : 'いつも分岐しなかった'}: ${text[l.no - 1].trim()}`);
    }
    detail.push('');
  }
  const line = `合計: 命令 ${pct(tot.run, tot.lines)} (${tot.lines - tot.run} / ${tot.lines} 行が未実行)   分岐 ${pct(tot.both, tot.br)} が両方向`;
  out.push(...rows, '', line, '', ...detail);
  summary.push(`${prof.title}: ${line}`);
}
writeFileSync(join(outDir, 'report.txt'), out.join('\n') + '\n');
console.log('');
for (const s of summary) console.log(s);
console.log(`詳しくは ${relative(root, join(outDir, 'report.txt'))}`);
if (failed.length) { console.log(`失敗したテスト: ${failed.join(', ')}`); process.exit(1); }

function pct(a, b) { return b ? `${(100 * a / b).toFixed(1)}%` : '-'; }
