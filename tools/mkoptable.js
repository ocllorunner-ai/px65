// モニターの逆アセンブラが使う命令表を、CPUコアの命令表(src/cpu65c02.js)から作る
//
//   node tools/mkoptable.js            # rom/optable.s を書き出す
//
// CPUコアと同じ表から作るので、逆アセンブルの結果がエミュレーターの動作と食い違わない。

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPCODES } from '../src/cpu65c02.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// アドレッシングの並び(この順番が番号になる)と、表示のしかた
//   len: 命令の長さ、pre: 前に付ける文字、kind: オペランドの種類、suf: 後ろに付ける文字
//   kind 0: なし  1: 1バイト  2: 2バイト  3: 相対分岐  4: ゼロページ+相対分岐  5: "A"
export const MODES = [
  ['imp', 1, '', 0, ''],
  ['acc', 1, '', 5, ''],
  ['imm', 2, '#', 1, ''],
  ['zp', 2, '', 1, ''],
  ['zpx', 2, '', 1, ',X'],
  ['zpy', 2, '', 1, ',Y'],
  ['izx', 2, '(', 1, ',X)'],
  ['izy', 2, '(', 1, '),Y'],
  ['izp', 2, '(', 1, ')'],
  ['abs', 3, '', 2, ''],
  ['abx', 3, '', 2, ',X'],
  ['aby', 3, '', 2, ',Y'],
  ['ind', 3, '(', 2, ')'],
  ['aix', 3, '(', 2, ',X)'],
  ['rel', 2, '', 3, ''],
  ['zpr', 3, '', 4, ''],
  ['n1', 1, '', 0, ''],
  ['n2', 2, '', 1, ''],
  ['n3', 3, '', 2, ''],
];

function generate() {
  const modeIndex = new Map(MODES.map((m, i) => [m[0], i]));
  const names = [];
  const mnem = [], mode = [];
  for (let op = 0; op < 256; op++) {
    const e = OPCODES[op];
    if (!names.includes(e.name)) names.push(e.name);
    mnem.push(names.indexOf(e.name));
    if (!modeIndex.has(e.mode)) throw new Error(`unknown mode ${e.mode}`);
    mode.push(modeIndex.get(e.mode));
  }
  const hex = (v) => '$' + v.toString(16).toUpperCase().padStart(2, '0');
  const rows = (arr) => {
    const out = [];
    for (let i = 0; i < arr.length; i += 16) {
      out.push(`        .byte ${arr.slice(i, i + 16).map(hex).join(', ')}   ; $${i.toString(16).toUpperCase().padStart(2, '0')}`);
    }
    return out.join('\n');
  };
  const chr = (s, i) => (s[i] ? `'${s[i]}'` : '0');
  const lines = [
    '; 命令表(tools/mkoptable.js が src/cpu65c02.js から生成。手で直さないこと)',
    '',
    ...MODES.map((m, i) => `OPM_${m[0].toUpperCase()} = ${i}`),
    '',
    '; オペコード -> ニーモニックの番号',
    'op_mnem:',
    rows(mnem),
    '',
    '; オペコード -> アドレッシングの番号',
    'op_mode:',
    rows(mode),
    '',
    '; ニーモニック(3文字ずつ)。RMB/SMB/BBR/BBS のビット番号は表示するときに付け足す',
    'mnem_text:',
    ...names.map((n, i) => `        .byte "${n}"   ; ${i}`),
    '',
    '; アドレッシングごとの長さ、前に付ける文字、オペランドの種類、後ろに付ける文字(最大3文字)',
    `m_len:  .byte ${MODES.map((m) => m[1]).join(', ')}`,
    `m_pre:  .byte ${MODES.map((m) => (m[2] ? `'${m[2]}'` : '0')).join(', ')}`,
    `m_kind: .byte ${MODES.map((m) => m[3]).join(', ')}`,
    `m_suf1: .byte ${MODES.map((m) => chr(m[4], 0)).join(', ')}`,
    `m_suf2: .byte ${MODES.map((m) => chr(m[4], 1)).join(', ')}`,
    `m_suf3: .byte ${MODES.map((m) => chr(m[4], 2)).join(', ')}`,
    '',
  ];
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(root, 'rom/optable.s');
  writeFileSync(out, generate());
  console.log(`rom/optable.s written`);
}
