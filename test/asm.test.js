// アセンブラのテスト
//   node test/asm.test.js
//
// 1. 全命令×全アドレッシングを書いて、正しいオペコードとオペランドになるか
// 2. ラベル、前方参照、式、疑似命令
// 3. エラーの検出

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../tools/asm.js';
import { OPCODES } from '../src/cpu65c02.js';
import { convertAs65 } from './as65.js';

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) return;
  failures++;
  console.log(`  FAIL  ${name}: expected ${e}, got ${a}`);
}
const bytesAt = (r, addr, n) => Array.from(r.mem.subarray(addr, addr + n));

console.log('every opcode');
{
  // オペランドの書き方。zp系は $12、abs系は $1234
  const syntax = {
    imp: '', acc: 'A', imm: '#$12', zp: '$12', zpx: '$12,X', zpy: '$12,Y', abs: '$1234',
    abx: '$1234,X', aby: '$1234,Y', ind: '($1234)', aix: '($1234,X)', izx: '($12,X)',
    izy: '($12),Y', izp: '($12)',
  };
  const operandBytes = { imp: [], acc: [], imm: [0x12], zp: [0x12], zpx: [0x12], zpy: [0x12],
    abs: [0x34, 0x12], abx: [0x34, 0x12], aby: [0x34, 0x12], ind: [0x34, 0x12], aix: [0x34, 0x12],
    izx: [0x12], izy: [0x12], izp: [0x12] };
  let count = 0;
  for (let op = 0; op < 256; op++) {
    const e = OPCODES[op];
    if (['n1', 'n2', 'n3'].includes(e.mode)) continue;
    const bit = ['RMB', 'SMB', 'BBR', 'BBS'].includes(e.name) ? String((op >> 4) & 7) : '';
    const mnem = e.name + bit;
    let src, expected;
    if (e.mode === 'rel') {
      src = `.org $1000\n ${mnem} target\n.org $1010\ntarget:`;
      expected = [op, 0x0e];
    } else if (e.mode === 'zpr') {
      src = `.org $1000\n ${mnem} $12, target\n.org $1010\ntarget:`;
      expected = [op, 0x12, 0x0d];
    } else {
      src = `.org $1000\n ${mnem} ${syntax[e.mode]}`;
      expected = [op, ...operandBytes[e.mode]];
    }
    const r = assemble(src);
    check(`${mnem} ${e.mode} ($${op.toString(16)})`, bytesAt(r, 0x1000, expected.length), expected);
    check(`${mnem} ${e.mode} size`, r.hi - r.lo + 1, expected.length);
    count++;
  }
  console.log(`  checked ${count} opcodes`);
}

console.log('labels, expressions, directives');
{
  const r = assemble(`
VALUE = $1234
ZP = $80
    .org $C000
start:
    lda #<VALUE        ; 下位
    ldx #>VALUE        ; 上位
    sta ZP             ; ゼロページを選ぶ
    sta later          ; 前方参照は絶対アドレス
    jmp start
    bra start
later:
    .byte 1, 2, "AB", 'C', -1
    .word later, VALUE+1
    .fill 3, $EA
    .byte (2+3)*4, %1010, 10/3, 1<<4, $F0>>4, $FF&$0F, $F0|$0F, $FF^$0F, *&$FF
  `);
  const s = r.symbols;
  check('start', s.START, 0xc000);
  check('lda #<', bytesAt(r, 0xc000, 2), [0xa9, 0x34]);
  check('ldx #>', bytesAt(r, 0xc002, 2), [0xa2, 0x12]);
  check('sta zp', bytesAt(r, 0xc004, 2), [0x85, 0x80]);
  check('sta forward', bytesAt(r, 0xc006, 3), [0x8d, 0x0e, 0xc0]);
  check('jmp', bytesAt(r, 0xc009, 3), [0x4c, 0x00, 0xc0]);
  check('bra back', bytesAt(r, 0xc00c, 2), [0x80, 0xf2]);
  check('later', s.LATER, 0xc00e);
  check('.byte', bytesAt(r, 0xc00e, 6), [1, 2, 0x41, 0x42, 0x43, 0xff]);
  check('.word', bytesAt(r, 0xc014, 4), [0x0e, 0xc0, 0x35, 0x12]);
  check('.fill', bytesAt(r, 0xc018, 3), [0xea, 0xea, 0xea]);
  check('expressions', bytesAt(r, 0xc01b, 9), [20, 10, 3, 16, 15, 15, 0xff, 0xf0, 0x23]);
}

console.log('.include');
{
  const dir = mkdtempSync(join(tmpdir(), 'px65-asm-'));
  writeFileSync(join(dir, 'inc.s'), 'VALUE = $42\ninc_label:\n .byte VALUE\n');
  writeFileSync(join(dir, 'bad.s'), ' nop\n foo\n');
  const main = join(dir, 'main.s');
  const r = assemble('.org $2000\n lda #VALUE\n .include "inc.s"  ; comment\n .word inc_label', main);
  check('included source', bytesAt(r, 0x2000, 5), [0xa9, 0x42, 0x42, 0x02, 0x20]);
  try {
    assemble(' .include "bad.s"', main);
    failures++;
    console.log('  FAIL  error in included file: no error');
  } catch (err) {
    check('error names the included file and line', /bad\.s:2: /.test(err.message), true);
  }
}

console.log('errors');
{
  const expectError = (name, src, pattern) => {
    try {
      assemble(src);
      failures++;
      console.log(`  FAIL  ${name}: no error`);
    } catch (err) {
      if (!pattern.test(err.message)) {
        failures++;
        console.log(`  FAIL  ${name}: unexpected message: ${err.message}`);
      }
    }
  };
  expectError('unknown instruction', ' foo', /未知の命令/);
  expectError('undefined symbol', ' lda nowhere', /未定義/);
  expectError('bad mode', ' stx $1234,X', /使えません/);
  expectError('branch too far', '.org $1000\n beq far\n.org $1100\nfar:', /遠すぎ/);
  expectError('duplicate label', 'a:\na:', /重複/);
  expectError('overlap', '.org $10\n nop\n.org $10\n nop', /二重/);
  expectError('immediate too big', ' lda #$123', /1バイト/);
  expectError('missing include', ' .include "no_such_file.s"', /読めません/);
}

// 4. CPU テスト用の as65 変換(test/as65.js)の if の式: 16進、2進、文字、名前
{
  const src = [
    ' if $10 = 16', ' db 1', ' endif',
    ' if %10 = 2', ' db 2', ' endif',
    'A = $10',
    ' if A = 16', ' db 3', ' else', ' db 4', ' endif',
    ' if (A & $F0) >= $10', ' db 5', ' endif',
    " if 'A' != 65", ' db 6', ' endif',
    'x10 = 3', ' if x10 = 3', ' db 7', ' endif',
  ].join('\n');
  const bytes = convertAs65(src).split('\n').filter((l) => l.includes('.byte')).map((l) => l.trim());
  check('as65 if with $, %, char and names', bytes, ['.byte 1', '.byte 2', '.byte 3', '.byte 5', '.byte 7']);
}

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
