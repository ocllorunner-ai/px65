// モニター ROM のテスト
//   node test/monitor.test.js
//
// rom/monitor.s をアセンブルしてエミュレーターで動かし、キーを押して画面とメモリを確かめる。
// 画面の文字は、ROM のフォントと突き合わせて文字列に戻して比べる。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble } from '../tools/asm.js';
import { Machine } from '../src/machine.js';
import { disassemble } from '../src/disasm.js';
import { OPCODES } from '../src/cpu65c02.js';
import { watchMachine, PROFILE_MONITOR } from './watch.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const asm = assemble(readFileSync(join(root, 'rom/monitor.s'), 'utf8'), join(root, 'rom/monitor.s'));
const ROM = asm.mem.subarray(0xa000, 0x10000);
const SYM = asm.symbols;

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok    ${name}`); return; }
  failures++;
  console.log(`  FAIL  ${name}\n        expected ${e}\n        got      ${a}`);
}

// ---- 画面を文字列に戻す ----
const glyphToChar = new Map();
for (let c = 0x20; c <= 0x7e; c++) {
  const g = Array.from(asm.mem.subarray(SYM.FONT + (c - 0x20) * 5, SYM.FONT + (c - 0x20) * 5 + 5));
  glyphToChar.set([...g, 0].join(','), String.fromCharCode(c));
}
function screen(m) {
  const lines = [];
  for (let row = 0; row < 4; row++) {
    let s = '';
    for (let col = 0; col < 16; col++) {
      const base = 0x0400 + row * 96 + col * 6;
      const cell = Array.from(m.bus.ram.subarray(base, base + 6));
      const ch = glyphToChar.get(cell.join(','))
        ?? glyphToChar.get(cell.map((b) => b ^ 0xff).join(',')); // カーソルで反転している
      s += ch ?? '#';
    }
    lines.push(s.trimEnd());
  }
  return lines;
}

// ---- キー入力 ----
const MATRIX = [
  'ABCDEFGH', 'IJKLMNOP', 'QRSTUVWX', ['Y', 'Z', ' ', 'RET', 'SHIFT', 'DEL', ',', '.'],
  '01234567', ['8', '9', '+', '-', '*', '/', '='], ['LEFT', 'RIGHT', 'UP', 'DOWN'],
];
const POS = new Map();
MATRIX.forEach((row, r) => [...row].forEach((name, c) => POS.set(name, [r, c])));
// SHIFT と組み合わせて打つ文字 -> 元のキー
const SHIFTED = { '!': '1', '"': '2', '#': '3', '$': '4', '%': '5', '&': '6', "'": '7', '(': '8', ')': '9',
  '@': '0', '<': ',', '>': '.', '?': '/', '_': '-', ':': '*', ';': '+', '^': '=' };

function pressKey(m, name, shift = false) {
  const pos = POS.get(name);
  if (!pos) throw new Error(`no key: ${name}`);
  if (shift) m.bus.setKey(3, 4, true);
  m.bus.setKey(pos[0], pos[1], true);
  frames(m, 3);
  m.bus.setKey(pos[0], pos[1], false);
  if (shift) m.bus.setKey(3, 4, false);
  frames(m, 3);
}

// 文字列を打つ。{RET} {DEL} {UP} {DOWN} {LEFT} {RIGHT} も書ける。\n は RET
function type(m, text) {
  const re = /\{(\w+)\}|([\s\S])/g;
  let mt;
  while ((mt = re.exec(text))) {
    if (mt[1]) { pressKey(m, mt[1]); if (mt[1] === 'RET') frames(m, 8); continue; }
    const ch = mt[2];
    if (ch === '\n') { pressKey(m, 'RET'); frames(m, 8); } // エラーのビープが終わるまで待つ
    else if (/[a-z]/.test(ch)) pressKey(m, ch.toUpperCase(), true);
    else if (SHIFTED[ch]) pressKey(m, SHIFTED[ch], true);
    else pressKey(m, ch);
  }
}

// プロンプト(最下行の "*")の上にある3行。最下行がプロンプトでなければ印を付ける
function out(m) {
  const s = screen(m);
  return s[3] === '*' ? s.slice(0, 3) : [...s.slice(0, 3), `(no prompt: ${s[3]})`];
}

function frames(m, n) { for (let i = 0; i < n; i++) m.runFrame(); }

function boot() {
  const m = watchMachine(new Machine(), PROFILE_MONITOR(asm));
  m.loadROM(ROM);
  m.powerOn();
  frames(m, 10);
  return m;
}
// 画面の行のうち、プロンプト(*)だけの行を除いたもの
const last = (m) => screen(m).filter((l) => l !== '*');
const peek = (m, addr, n = 1) => Array.from(m.bus.ram.subarray(addr, addr + n));
const poke = (m, addr, bytes) => m.bus.ram.set(bytes, addr);

// ===================================================================
console.log('boot');
{
  const m = boot();
  check('banner', screen(m), ['PX-65 MONITOR', 'V0.11', '*', '']);
  check('display on', m.bus.displayOn, true);
  check('timer IRQ enabled', m.bus.timerEnable, true);
  check('ROM fits below the jump table', SYM.ROM_END <= 0xff00, true);
}

console.log('typing and line editing');
{
  const m = boot();
  type(m, 'ABC{DEL}{DEL}X');
  check('DEL erases', screen(m)[2], '*AX');
  type(m, 'YZ0123456789ABCDEFGHIJ');
  check('long line wraps', screen(m).slice(2), ['*AXYZ0123456789A', 'BCDEFGHIJ']);
  for (let i = 0; i < 10; i++) type(m, '{DEL}');
  check('DEL goes back across the wrap', screen(m).slice(2), ['*AXYZ0123456789', '']);
  m.pressBreak();
  frames(m, 3);
  check('BREAK abandons the line', screen(m).slice(2), ['*AXYZ0123456789', '*']);
}

console.log('line editor: moving the cursor, inserting and deleting');
{
  const line = (m) => String.fromCharCode(...peek(m, SYM.LINEBUF, m.bus.ram[SYM.LINELEN]));
  const hist = (m) => String.fromCharCode(...peek(m, SYM.HISTBUF, m.bus.ram[SYM.HISTLEN]));  // RET で確定した行
  const at = (m) => [m.bus.ram[SYM.CUR_X], m.bus.ram[SYM.CUR_Y]];
  let m = boot();
  type(m, 'ABCDE{LEFT}{LEFT}X');
  check('← moves the cursor and a key inserts there', screen(m)[2], '*ABCXDE');
  check('the cursor is after the inserted character', [m.bus.ram[SYM.LINEPOS], ...at(m)], [4, 5, 2]);
  type(m, '{DEL}{DEL}');
  check('DEL erases the character before the cursor', screen(m)[2], '*ABDE');
  type(m, '{RIGHT}{RIGHT}{RIGHT}{RIGHT}');
  check('→ stops at the end of the line', [m.bus.ram[SYM.LINEPOS], ...at(m)], [4, 5, 2]);
  type(m, '{LEFT}'.repeat(6));
  check('← stops at the start of the line', [m.bus.ram[SYM.LINEPOS], ...at(m)], [0, 1, 2]);
  type(m, '{DEL}');
  check('DEL at the start does nothing', screen(m)[2], '*ABDE');
  type(m, '{RIGHT}{RIGHT}\n');
  check('RET in the middle takes the whole line', hist(m), 'ABDE');
  check('and the cursor goes to the end before the new line', screen(m).slice(2), ['*ABDE', '0BDE']);  // A コマンド

  // 折り返した行の途中
  m = boot();
  type(m, '0123456789ABCDEFGHIJ');                 // "*" + 20文字 -> 2行
  type(m, '{LEFT}'.repeat(10));                    // 'A' の前(1行目の右端の近く)
  check('← goes back across the wrap', at(m), [11, 2]);
  type(m, '{LEFT}'.repeat(6));                     // '4' の前
  type(m, 'XY');
  check('inserting pushes the rest onto the next row', screen(m).slice(2), ['*0123XY456789ABC', 'DEFGHIJ']);
  check('the cursor stays right after the insert', at(m), [7, 2]);
  type(m, '{RIGHT}'.repeat(10));                   // 'D' の後(2行目)
  check('→ goes forward across the wrap', at(m), [1, 3]);
  type(m, '{DEL}{DEL}{DEL}');
  check('DEL pulls the rest back across the wrap', screen(m).slice(2), ['*0123XY456789AEF', 'GHIJ']);
  check('the cursor follows', at(m), [14, 2]);
  type(m, '{LEFT}'.repeat(8) + 'PQRSTUVWXYZ01');  // 'X' の後に入れて3行に伸ばす(最下行でスクロール)
  check('a longer line scrolls the screen', screen(m),
    ['V0.11', '*0123XPQRSTUVWXY', 'Z01Y456789AEFGHI', 'J']);
  check('and the cursor moves up with it', at(m), [3, 2]);
  type(m, '\n');
  check('RET takes the whole line', hist(m), '0123XPQRSTUVWXYZ01Y456789AEFGHIJ');

  // ↑ で呼び出す(カーソルが途中にあっても全部を置き換える)
  m = boot();
  type(m, 'D 0\n');
  type(m, 'HELLO{LEFT}{LEFT}{LEFT}{UP}');
  check('↑ replaces the whole line even with the cursor in the middle', screen(m)[3], '*D 0');
  type(m, '{LEFT}{LEFT}{DEL}E');
  check('and the recalled line can be edited', screen(m)[3], '*E 0');

  // 58文字いっぱいのときは入らない
  m = boot();
  type(m, 'A'.repeat(58) + '{LEFT}{LEFT}B');
  check('no insert when the line is full', [m.bus.ram[SYM.LINELEN], line(m).includes('B')], [58, false]);
}

console.log('unknown command');
{
  const m = boot();
  type(m, 'Z\n');
  check('shows ?', out(m).slice(1), ['*Z', '?']);
  check('beeps', m.bus.beepEvents.length > 100, true);
}

console.log('E and D');
{
  const m = boot();
  type(m, 'E 600 A9 1 8D,03 bf\n');
  check('E writes bytes', peek(m, 0x600, 5), [0xa9, 0x01, 0x8d, 0x03, 0xbf]);
  type(m, 'e 0610 "Hi"\n');
  check('E writes a string (shift for lower case and ")', peek(m, 0x610, 2), [0x48, 0x69]);
  type(m, 'D 600\n');
  check('D shows 16 bytes', screen(m), ['0600 A9 01 8D 03', '0604 BF 00 00 00', '0608 00 00 00 00', '060C 00 00 00 00']);
  type(m, '{DOWN}');
  check('DOWN moves 4 bytes', screen(m)[0], '0604 BF 00 00 00');
  type(m, '{UP}{UP}');
  check('UP moves back', screen(m)[0], '05FC 00 00 00 00');
  type(m, '\n');
  check('RET moves 16 bytes', screen(m)[0], '060C 00 00 00 00');
  type(m, 'H');
  check('another key leaves and starts a command', screen(m).slice(2), ['0618 00 00 00 00', '*H']);
  type(m, '{DEL}D\n');
  check('D continues after the last page', screen(m)[0], '061C 00 00 00 00');
}

console.log('E interactive');
{
  const m = boot();
  poke(m, 0x700, [0x11, 0x22, 0x33]);
  type(m, 'E 700\n');
  check('shows address and value', screen(m)[3], '0700 11-');
  type(m, '4');
  type(m, '4 ');
  type(m, ' ');
  type(m, 'F{DEL}5{UP}');
  type(m, '\n');
  check('writes typed values only', peek(m, 0x700, 3), [0x44, 0x22, 0x05]);
  check('screen (UP goes back a line)', out(m), ['0701 22-', '0702 33-5', '0701 22-']);
}

console.log('F, M, S, C');
{
  const m = boot();
  type(m, 'F 700 70F 55\n');
  check('F fills', peek(m, 0x700, 17), [...Array(16).fill(0x55), 0x00]);
  type(m, 'F 700 705 1 2 3\n');
  check('F repeats a pattern', peek(m, 0x700, 7), [1, 2, 3, 1, 2, 3, 0x55]);
  type(m, 'F 705 700 1\n');
  check('F rejects end < start', out(m)[2], '?');

  const seq = Array.from({ length: 16 }, (_, i) => i);
  poke(m, 0x700, seq);
  type(m, 'M 700 70F 701\n');
  check('M overlapping, forwards', peek(m, 0x700, 17), [0, ...seq]);
  poke(m, 0x700, [...seq, 0xee]);
  type(m, 'M 701 710 700\n');
  check('M overlapping, backwards', peek(m, 0x700, 17), [...seq.slice(1), 0xee, 0xee]);
  type(m, 'M 700 70F 7F00\n');
  check('M to another area', peek(m, 0x7f00, 16), [...seq.slice(1), 0xee]);

  poke(m, 0x800, [0xa2, 0x07, 0, 0, 0xa2, 0x07, 0, 0xa2, 0x07]);
  type(m, 'S 800 8FF A2 7\n');
  check('S lists matches', out(m)[2], '0800 0804 0807');
  type(m, 'S 800 8FF 12 34\n');
  check('S with no match', screen(m).slice(2), ['*S 800 8FF 12 34', '*']);

  poke(m, 0x900, [1, 2, 3, 4]);
  poke(m, 0xa00, [1, 9, 3, 8]);
  type(m, 'C 900 903 A00\n');
  check('C lists differences', out(m), ['*C 900 903 A00', '0901 02 0A01 09', '0903 04 0A03 08']);
}

console.log('H and R');
{
  const m = boot();
  type(m, 'H 1234 100\n');
  check('H sum and difference', out(m)[2], '1334 1134');
  type(m, 'H 1 2\n');
  check('H wraps', out(m)[2], '0003 FFFF');
  type(m, 'R A 12\nR X 34\nR Y 56\nR P C3\nR S 80\nR PC 1234\nR\n');
  check('R shows registers', out(m), ['A=12 X=34 Y=56', 'S=80 P=NV-...ZC', '1234 BRK']);
  type(m, 'R A 123\n');
  check('8-bit register rejects 3 digits', out(m)[2], '?');
  type(m, 'R Q 1\n');
  check('unknown register', out(m)[2], '?');
}

console.log('U');
{
  const m = boot();
  poke(m, 0x600, [0xa9, 0x42, 0x8d, 0x00, 0x04, 0xb1, 0x02, 0xd0, 0xf7, 0x3f, 0x12, 0xfd, 0x60]);
  type(m, 'U 600\n');
  check('U shows 4 lines', screen(m), ['0600 LDA #42', '0602 STA 0400', '0605 LDA (02),Y', '0607 BNE 0600']);
  type(m, '{DOWN}');
  check('DOWN adds one line (BBR wraps)', screen(m).slice(2), ['0609 BBR3 12,060', '9']);
  type(m, '\n');
  check('RET adds 4 lines', screen(m), ['060C RTS', '060D BRK', '060E BRK', '060F BRK']);
}

console.log('disassembler matches src/disasm.js for every opcode');
{
  const m = boot();
  let bad = 0;
  for (let op = 0; op < 256; op++) {
    // 0700: JSR disline / STP
    poke(m, 0x700, [0x20, SYM.DISLINE & 0xff, SYM.DISLINE >> 8, 0xdb]);
    poke(m, 0x600, [op, 0x34, 0x12]);
    poke(m, SYM.DADDR, [0x00, 0x06]);
    m.bus.ram.fill(0, 0x400, 0x580);
    poke(m, SYM.CUR_X, [0, 0]);
    m.cpu.stopped = false;
    m.cpu.waiting = false;
    m.cpu.pc = 0x700;
    let n = 0;
    while (!m.cpu.stopped && n++ < 100000) m.step();
    const s = screen(m);
    const got = (s[0].padEnd(16) + s[1]).trimEnd();
    const d = disassemble((a) => m.bus.read(a), 0x600);
    const want = ('0600 ' + d.text).replace(/\$/g, '');
    const len = (m.bus.ram[SYM.DADDR] | (m.bus.ram[SYM.DADDR + 1] << 8)) - 0x600;
    if (got !== want || len !== d.length) {
      if (bad++ < 5) console.log(`        $${op.toString(16)}: got "${got}" (${len}) want "${want}" (${d.length})`);
    }
  }
  check('all 256 opcodes', bad, 0);
}

// テスト用のプログラム
//   0600 LDA #$42 / LDX #$07 / JSR $0620 / LDY #$09 / RTS
//   0620 INX / RTS
const PROG = [0xa9, 0x42, 0xa2, 0x07, 0x20, 0x20, 0x06, 0xa0, 0x09, 0x60];
function bootWithProgram() {
  const m = boot();
  poke(m, 0x600, PROG);
  poke(m, 0x620, [0xe8, 0x60]);
  return m;
}

console.log('G');
{
  const m = bootWithProgram();
  type(m, 'G 600\n');
  check('runs to RTS and shows registers', out(m).slice(1), ['A=42 X=08 Y=09', 'S=FF P=..-B....']);
  check('BUSY is off again', m.bus.lcdAnn & 1, 0);
  type(m, 'G\n');
  check('G again starts over (stack balanced)', out(m).slice(1), ['A=42 X=08 Y=09', 'S=FF P=..-B....']);
}

console.log('B (breakpoints)');
{
  const m = bootWithProgram();
  type(m, 'B 607\n');
  check('B lists', out(m)[2], '0607');
  type(m, 'B 620\nB 620\n');
  check('adding twice keeps one', out(m)[2], '0607 0620');
  type(m, 'G 600\n');
  check('stops at 0620 (S: return to monitor + JSR)', out(m), ['A=42 X=07 Y=00', 'S=FB P=..-B....', '0620 INX']);
  check('BRK bytes are removed while stopped', peek(m, 0x607), [0xa0]);
  type(m, 'G\n');
  check('continues to next breakpoint', out(m), ['A=42 X=08 Y=00', 'S=FD P=..-B....', '0607 LDY #09']);
  type(m, 'G\n');
  check('continues to the end', out(m).slice(1), ['A=42 X=08 Y=09', 'S=FF P=..-B....']);
  type(m, 'B - 607\n');
  check('B - removes one', out(m)[2], '0620');
  type(m, 'B -\n');
  check('B - removes all', out(m)[2], '-');
  type(m, 'B 8000\n');
  check('only RAM', out(m)[2], '?');
  check('program unchanged', peek(m, 0x600, PROG.length), PROG);
}

console.log('T and P');
{
  const m = bootWithProgram();
  type(m, 'R PC 600\nT\n');
  check('T steps one instruction', out(m), ['A=42 X=00 Y=00', 'S=FD P=..-B....', '0602 LDX #07']);
  type(m, 'T 2\n');
  check('T into JSR', out(m), ['A=42 X=07 Y=00', 'S=FB P=..-B....', '0620 INX']);
  type(m, 'T 2\n');
  check('T through RTS', out(m)[2], '0607 LDY #09');
  type(m, 'R PC 600\nR S FF\nP 3\n');
  check('P steps over JSR', out(m), ['A=42 X=08 Y=00', 'S=FF P=..-B....', '0607 LDY #09']);
  check('no BRK left in memory', [peek(m, 0x600, PROG.length), peek(m, 0x620, 2)], [PROG, [0xe8, 0x60]]);
  type(m, 'T 0\n');
  check('T 0 is an error', out(m)[2], '?');
}

console.log('G from a breakpoint');
{
  const m = bootWithProgram();
  type(m, 'B 602\nG 600\n');
  check('stopped at 0602', out(m)[2], '0602 LDX #07');
  type(m, 'G\n');
  check('G steps past it and runs to the end', out(m).slice(1), ['A=42 X=08 Y=09', 'S=FF P=..-B....']);
}

console.log('BREAK key');
{
  const m = boot();
  poke(m, 0x600, [0xe8, 0x4c, 0x00, 0x06]); // INX / JMP $0600
  type(m, 'G 600\n');
  frames(m, 10);
  check('BUSY while running', m.bus.lcdAnn & 1, 1);
  m.pressBreak();
  frames(m, 3);
  const s = out(m);
  check('stops and shows where', /^060[01] (INX|JMP 0600)$/.test(s[2]), true);
  check('back at the prompt', m.bus.lcdAnn & 1, 0);
  type(m, 'B 601\nG\n');
  check('can continue', out(m)[2], '0601 JMP 0600');
}

console.log('BRK in a program');
{
  const m = boot();
  poke(m, 0x600, [0xa9, 0x05, 0x00, 0xff, 0xa9, 0x06, 0x60]); // LDA #5 / BRK $FF / LDA #6 / RTS
  type(m, 'G 600\n');
  check('stops after BRK', out(m), ['A=05 X=00 Y=00', 'S=FD P=..-B....', '0604 LDA #06']);
  type(m, 'G\n');
  check('continues', out(m)[1], 'A=06 X=00 Y=00');
}

console.log('BIOS calls from a program');
{
  const m = boot();
  // JSR PRINT "OK" / LDA #$3C / JSR PRHEX / JSR GETKEY / STA $0700 / RTS
  poke(m, 0x600, [0x20, 0x0f, 0xff, 0x4f, 0x4b, 0x00, 0xa9, 0x3c, 0x20, 0x0c, 0xff,
    0x20, 0x03, 0xff, 0x8d, 0x00, 0x07, 0x60]);
  type(m, 'G 600\n');
  check('prints', screen(m)[3], 'OK3C');
  type(m, 'Q');
  check('GETKEY gets a key', peek(m, 0x700), [0x51]);
}

console.log('keyboard');
{
  const m = boot();
  type(m, 'E 700 "a!<_?:;^"\n');
  check('SHIFT combinations', peek(m, 0x700, 8), [0x61, 0x21, 0x3c, 0x5f, 0x3f, 0x3a, 0x3b, 0x5e]);
  check('SHIFT annunciator off', m.bus.lcdAnn & 2, 0);
  m.bus.setKey(3, 4, true);
  frames(m, 2);
  check('SHIFT annunciator on', m.bus.lcdAnn & 2, 2);
  m.bus.setKey(3, 4, false);
  // キーリピート: 0.5秒押し続けると繰り返す
  m.bus.setKey(0, 0, true); // A
  frames(m, 60);
  m.bus.setKey(0, 0, false);
  frames(m, 3);
  const line = screen(m)[3];
  check('key repeat', /^\*A{5,}$/.test(line), true);
  type(m, '{DEL}'.repeat(40) + 'D 0\n{RIGHT}');
  type(m, 'R\n{UP}');
  check('UP recalls the previous line', screen(m)[3], '*R');
}

console.log('W and L (virtual tape)');
{
  // ブロック: "PX" 種類 名前(8) 開始 長さ データ チェックサム
  const block = (type, name, start, data) => {
    const head = [0x50, 0x58, type, ...[...name.padEnd(8)].map((c) => c.charCodeAt(0)),
      start & 0xff, start >> 8, data.length & 0xff, data.length >> 8];
    const all = [...head, ...data];
    return [...all, all.reduce((a, b) => a + b, 0) & 0xff];
  };
  const m = bootWithProgram();
  type(m, 'W 600 609\n');
  check('W reports the range', out(m)[2], 'SAVE 0600-0609');
  check('tape format', Array.from(m.bus.tape), block(1, '', 0x600, PROG));
  check('tape stopped after W', m.bus.tapeMode, 0);

  type(m, 'F 600 609 0\nR PC 0\nL\n');
  check('L reports the range', out(m)[2], 'LOAD 0600-0609');
  check('L restores memory', peek(m, 0x600, PROG.length), PROG);
  check('tape stopped after L', m.bus.tapeMode, 0);
  check('BUSY off', m.bus.lcdAnn & 1, 0);
  type(m, 'G\n');
  check('G runs the loaded program', out(m).slice(1), ['A=42 X=08 Y=09', 'S=FF P=..-B....']);

  type(m, 'L 1000\n');
  check('L to another address', [out(m)[2], peek(m, 0x1000, PROG.length)], ['LOAD 1000-1009', PROG]);
  type(m, 'R\n');
  check('PC set to the loaded address', out(m)[2], '1000 LDA #42');

  // 名前付きで足していく
  poke(m, 0x700, [1, 2, 3]);
  type(m, 'W 700 702 "Abc"\n');
  poke(m, 0x700, [4, 5]);
  type(m, 'W 700 701 "LONGNAME99"\n');
  check('W appends named blocks', Array.from(m.bus.tape),
    [...block(1, '', 0x600, PROG), ...block(1, 'Abc', 0x700, [1, 2, 3]), ...block(1, 'LONGNAME', 0x700, [4, 5])]);
  type(m, 'F 700 702 0\nL "Abc"\n');
  check('L by name (case kept)', [out(m)[2], peek(m, 0x700, 3)], ['LOAD 0700-0702', [1, 2, 3]]);
  type(m, 'L "LONGNAME" 900\n');
  check('L by name to another address', [out(m)[2], peek(m, 0x900, 2)], ['LOAD 0900-0901', [4, 5]]);
  type(m, 'L "ABC"\n');
  check('name not found', out(m)[2], 'NOT FOUND');

  // 同じ名前のブロックがいくつかあれば、最後(最新)のものを読む
  m.bus.insertTape(Uint8Array.from([...block(1, 'DUP', 0x700, [1]), ...block(1, 'X', 0x700, [9]),
    ...block(1, 'DUP', 0x700, [2]), ...block(2, 'DUP', 0x800, [8]), ...block(1, 'DUP', 0x700, [3]),
    ...block(1, 'Y', 0x700, [7])]));
  type(m, 'L "DUP"\n');
  check('L by name reads the last block with that name', [out(m)[2], peek(m, 0x700)], ['LOAD 0700-0700', [3]]);
  type(m, 'L "DUP" 900\n');
  check('also with an address', [out(m)[2], peek(m, 0x900)], ['LOAD 0900-0900', [3]]);
  type(m, 'L\n');
  check('L without a name still reads the first block', [out(m)[2], peek(m, 0x700)], ['LOAD 0700-0700', [1]]);
  // 最後のブロックが壊れていたら TAPE ERROR(古い版を黙って読まない)
  const dup2 = [...block(1, 'DUP', 0x700, [1]), ...block(1, 'DUP', 0x700, [2])];
  m.bus.insertTape(Uint8Array.from(dup2.slice(0, -1)));
  type(m, 'L "DUP"\n');
  check('a broken last block is a TAPE ERROR', out(m)[2], 'TAPE ERROR');

  // BASIC のブロックは L では読まない
  m.bus.insertTape(Uint8Array.from([...block(2, 'PROG', 0x800, [9, 9]), ...block(1, 'M', 0x650, [7])]));
  type(m, 'L\n');
  check('L skips other kinds of blocks', [out(m)[2], peek(m, 0x650)], ['LOAD 0650-0650', [7]]);

  const good = block(1, '', 0x600, PROG);
  m.bus.insertTape(new Uint8Array(0));
  type(m, 'L\n');
  check('empty tape', out(m)[2], 'NO TAPE');
  m.bus.insertTape(Uint8Array.from(good.map((v, i) => (i === 17 ? v ^ 1 : v))));
  type(m, 'L\n');
  check('checksum error', out(m)[2], 'TAPE ERROR');
  m.bus.insertTape(Uint8Array.from(good.slice(0, 20)));
  type(m, 'L\n');
  check('short tape', out(m)[2], 'TAPE ERROR');
  m.bus.insertTape(Uint8Array.from([0x41, 0x42, 0x43]));
  type(m, 'L\n');
  check('not a PX-65 tape', out(m)[2], 'TAPE ERROR');
  check('tape stopped and BUSY off after an error', [m.bus.tapeMode, m.bus.lcdAnn & 1], [0, 0]);
  type(m, 'W 610 600\n');
  check('W rejects end < start', out(m)[2], '?');
  // テープに入りきらないときは保存しない
  const full = new Uint8Array(65536 - 20).fill(0x55);
  m.bus.insertTape(full);
  type(m, 'W 600 6FF "X"\n');
  check('W on a full tape', out(m)[2], 'TAPE FULL');
  check('the tape is kept as it was', [m.bus.tape.length, m.bus.tapeMode, m.bus.lcdAnn & 1], [full.length, 0, 0]);
  m.bus.insertTape(new Uint8Array(65536 - 17).fill(0x55));
  type(m, 'W 600 600\n');
  check('W that just fits (17 bytes)', [out(m)[2], m.bus.tape.length], ['SAVE 0600-0600', 65536]);
}

console.log('assembler: every opcode round-trips through U and A');
{
  const m = boot();
  // ROM のルーチンを直接呼ぶ: 0700 JSR asm_one / STP。エラーなら a_err に来る
  const assembleLine = (text, addr = 0x600) => {
    m.bus.ram.fill(0xea, 0x600, 0x610);
    poke(m, 0x700, [0x20, SYM.ASM_ONE & 0xff, SYM.ASM_ONE >> 8, 0xdb]);
    const bytes = [...text].map((c) => c.charCodeAt(0));
    poke(m, SYM.LINEBUF, bytes);
    poke(m, SYM.LINELEN, [bytes.length]);
    poke(m, SYM.LP, [0]);
    poke(m, SYM.A_ADDR, [addr & 0xff, addr >> 8]);
    m.cpu.stopped = false;
    m.cpu.waiting = false;
    m.cpu.pc = 0x700;
    for (let n = 0; n < 200000; n++) {
      if (m.cpu.pc === SYM.A_ERR) return null;
      if (m.cpu.stopped) break;
      m.step();
    }
    const end = m.bus.ram[SYM.A_ADDR] | (m.bus.ram[SYM.A_ADDR + 1] << 8);
    return peek(m, addr, end - addr);
  };
  let bad = 0, count = 0;
  for (let op = 0; op < 256; op++) {
    if (['n1', 'n2', 'n3'].includes(OPCODES[op].mode)) continue;
    const src = [op, 0x34, 0x12];
    const d = disassemble((a) => src[a - 0x600] ?? 0, 0x600);
    const text = d.text.replace(/\$/g, '');
    const got = assembleLine(text);
    const want = src.slice(0, d.length);
    count++;
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      if (bad++ < 5) console.log(`        "${text}": got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    }
  }
  check(`all ${count} defined opcodes`, bad, 0);

  const cases = [
    ['lda #$41', [0xa9, 0x41]],
    ['LDA $0012', [0xad, 0x12, 0x00]],          // 3桁以上なら絶対番地
    ['LDA 12', [0xa5, 0x12]],
    ['JMP 12', [0x4c, 0x12, 0x00]],             // ゼロページがない命令
    ['STX 0012,Y', [0x96, 0x12]],               // 絶対番地がない形
    ['ASL', [0x0a]],
    ['ASL A', [0x0a]],
    ['LDA A', [0xa5, 0x0a]],                    // LDA にアキュムレーターはないので $0A
    ['LDA  ( 12 ) , Y', [0xb1, 0x12]],
    ['BNE 0600', [0xd0, 0xfe]],
    ['BRA 0681', [0x80, 0x7f]],
    ['BRA 0582', [0x80, 0x80]],
    ['BBS7 FF,0603', [0xff, 0xff, 0x00]],
  ];
  for (const [text, want] of cases) check(`"${text}"`, assembleLine(text), want);
  const errors = ['FOO', 'LDA', 'LDA #123', 'LDA (1234),Y', 'BNE 0682', 'BRA 0581', 'RMB 12', 'LDA1 12',
    'LDA 12,Z', 'LDA #', 'NOP 12', 'LDAX', 'BBR8 12,0600'];
  for (const text of errors) check(`error: "${text}"`, assembleLine(text), null);
}

console.log('A command');
{
  const m = boot();
  type(m, 'A 600\nlda #41\nJSR FF00\n');
  check('shows the next address', screen(m)[3], '0605');
  type(m, 'FOO\n');
  check('error stays at the same address', screen(m).slice(2), ['?', '0605']);
  type(m, 'RTS\n\n');
  check('bytes written', peek(m, 0x600, 6), [0xa9, 0x41, 0x20, 0x00, 0xff, 0x60]);
  check('empty line ends', screen(m)[3], '*');
  type(m, 'U\n');
  check('U continues from where A started', screen(m).slice(0, 3), ['0600 LDA #41', '0602 JSR FF00', '0605 RTS']);
  type(m, 'X');
  type(m, '{DEL}A\nBRK\n');
  check('A without an address continues', screen(m)[2], '0606 BRK');
  m.pressBreak();
  frames(m, 3);
  check('BREAK leaves A', screen(m)[3], '*');
  check('BRK written', peek(m, 0x606), [0x00]);
}

console.log('warm start');
{
  const m = bootWithProgram();
  type(m, 'B 607\nG 600\n');
  check('stopped at breakpoint', out(m)[2], '0607 LDY #09');
  // 実行中にリセットされた場合: 実行中はブレークポイントに BRK が書かれている
  poke(m, 0x610, [0x4c, 0x10, 0x06]); // JMP $0610
  type(m, 'G 610\n');
  frames(m, 5);
  check('BRK written while running', peek(m, 0x607), [0x00]);
  m.reset();
  frames(m, 10);
  check('banner after reset', screen(m)[0], 'PX-65 MONITOR');
  check('BRK removed on warm start', peek(m, 0x600, PROG.length), PROG);
  check('RAM kept', peek(m, 0x620, 2), [0xe8, 0x60]);
  type(m, 'B\n');
  check('breakpoints kept', out(m)[2], '0607');
  m.powerOn();
  frames(m, 10);
  type(m, 'B\n');
  check('cold start clears them', out(m)[2], '-');
}

console.log('T through every kind of jump (found by the coverage tool)');
{
  const m = boot();
  poke(m, 0x600, [0xa2, 0x02, 0xca, 0xd0, 0xfd, 0x4c, 0x10, 0x06]); // LDX #2 / DEX / BNE 0602 / JMP 0610
  poke(m, 0x610, [0x6c, 0x20, 0x06]);                               // JMP (0620)
  poke(m, 0x620, [0x30, 0x06]);
  poke(m, 0x630, [0xa2, 0x02, 0x7c, 0x3e, 0x06]);                   // LDX #2 / JMP (063E,X)
  poke(m, 0x640, [0x50, 0x06]);
  poke(m, 0x650, [0x8f, 0x10, 0x0d]);                               // BBS0 10,0660(分岐する)
  poke(m, 0x660, [0x0f, 0x10, 0x05]);                               // BBR0 10,0668(分岐しない)
  poke(m, 0x663, [0x20, 0x70, 0x06]);                               // JSR 0670
  poke(m, 0x666, [0xa9, 0x06, 0x48, 0xa9, 0x80, 0x48, 0x08, 0x40]); // 0680 と P を積んで RTI
  poke(m, 0x670, [0x60]);                                           // RTS
  poke(m, 0x680, [0xea, 0x00]);
  poke(m, 0x10, [0x01]);
  type(m, 'R PC 600\n');
  const pcs = [];
  // 逆アセンブルの行は折り返すことがあるので、4桁の番地で始まる最後の行を見る
  const pcLine = () => screen(m).filter((l) => /^[0-9A-F]{4} /.test(l)).pop().slice(0, 4);
  for (let i = 0; i < 18; i++) { type(m, 'T\n'); pcs.push(pcLine()); }
  check('PC after each T', pcs, ['0602', '0603', '0602', '0603', '0605', '0610', '0630', '0632', '0650',
    '0660', '0663', '0670', '0666', '0668', '0669', '066B', '066C', '066D']);
  type(m, 'T\n');
  check('RTI goes to the address on the stack', out(m)[2], '0680 NOP');
  check('no BRK left in memory', [peek(m, 0x600, 8), peek(m, 0x650, 3), peek(m, 0x660, 9), peek(m, 0x670, 1)],
    [[0xa2, 0x02, 0xca, 0xd0, 0xfd, 0x4c, 0x10, 0x06], [0x8f, 0x10, 0x0d], [0x0f, 0x10, 0x05, 0x20, 0x70, 0x06, 0xa9, 0x06, 0x48], [0x60]]);
}

// B23-01: G・T・P は BRK を書き込むとき、モニター自身もスタックを使っている。$00E0-$057F(モニターと BIOS の
// ゼロページ、スタック、作業領域、入力行、VRAM)に BRK を書くと、モニターの戻り番地などを壊して暴走した。
// 今は、B はその番地に置けず、T・P は次の命令の行き先を全部調べてから書き、1つでもその範囲なら何も書かずに止まる
console.log('B23-01: no BRK where the monitor works ($00E0-$057F)');
{
  const BP_LO = SYM.BP_LO, BP_HI = SYM.BP_HI;
  // B の境目
  {
    const m = boot();
    const res = [];
    for (const a of ['DF', 'E0', '1FD', '2C0', '57F', '580', '7FFF', '8000']) { type(m, `B ${a}\n`); res.push(last(m).at(-1)); }
    check('B accepts $0000-$00DF and $0580-$7FFF only', res, ['00DF', '?', '?', '?', '?', '00DF 0580', '00DF 0580 7FFF', '?']);
  }
  // B 1FD から G(0.11.16 まではモニターが暴走した)
  {
    const m = boot();
    poke(m, 0x600, [0xa9, 0x41, 0x48, 0xa9, 0x00, 0x68, 0x60]);   // LDA #41 / PHA / LDA #0 / PLA / RTS
    type(m, 'B 1FD\n');
    check('B 1FD is an error', last(m).at(-1), '?');
    type(m, 'G 600\n');
    check('G 600 then runs normally', out(m).slice(1), ['A=41 X=00 Y=00', 'S=FF P=..-B....']);
  }
  // 前の保存状態から読んだブレークポイント(置けない番地のもの)があれば、G は何も書かずに ?
  {
    const m = boot();
    poke(m, 0x600, [0xa9, 0x41, 0x48, 0xa9, 0x00, 0x68, 0x60]);
    poke(m, BP_LO, [0x05, 0xfd, 0, 0]);
    poke(m, BP_HI, [0x06, 0x01, 0xff, 0xff]);   // $0605 と $01FD
    const stack = peek(m, 0x1f0, 16);
    type(m, 'G 600\n');
    check('G with a saved breakpoint at $01FD is an error', last(m).at(-1), '?');
    check('nothing was written (the good one at $0605 neither)', [peek(m, 0x600, 7), peek(m, 0x1fd)], [[0xa9, 0x41, 0x48, 0xa9, 0x00, 0x68, 0x60], [stack[13]]]);
    type(m, 'B\n');
    check('B still lists it', last(m).at(-1), '0605 01FD');
    type(m, 'B - 1FD\nG 600\n');
    check('B - removes it, then G works', out(m), ['A=00 X=00 Y=00', 'S=FC P=..-B..Z.', '0605 PLA']);
  }
  // B を置かない T・P(0.11.16 までは、行き先 $01FD に一時 BRK を書いて暴走した)
  for (const cmd of ['T', 'P']) {
    const m = boot();
    poke(m, 0x600, [0x4c, 0xfd, 0x01]);   // JMP $01FD
    type(m, `R PC 600\n${cmd}\n`);
    check(`${cmd} into $01FD shows the registers and ?`, last(m).slice(-2), ['0600 JMP 01FD', '?']);
    check(`${cmd}: nothing written`, peek(m, 0x600, 3), [0x4c, 0xfd, 0x01]);
    type(m, 'H 1 2\n');
    check(`${cmd}: the monitor still works`, last(m).at(-1), '0003 FFFF');
    type(m, 'R\n');
    check(`${cmd}: PC has not moved`, last(m).at(-1), '0600 JMP 01FD');
  }
  // T 5 の途中で止まる: 2命令進んで、JMP $0200 の前で ?
  {
    const m = boot();
    poke(m, 0x610, [0xe8, 0xe8, 0x4c, 0x00, 0x02]);   // INX / INX / JMP $0200
    type(m, 'R X 0\nR PC 610\nT 5\n');
    check('T 5 stops before JMP $0200', last(m).slice(-2), ['0612 JMP 0200', '?']);
    type(m, 'R\n');
    check('after two steps', last(m).slice(-3), ['A=00 X=02 Y=00', 'S=FD P=..-B....', '0612 JMP 0200']);
    check('no BRK left', peek(m, 0x610, 5), [0xe8, 0xe8, 0x4c, 0x00, 0x02]);
  }
  // 条件分岐: 行き先の2つのうち1つ($0570、VRAM)だけが範囲の中。もう1つ($0592)にも書かない
  {
    const m = boot();
    poke(m, 0x590, [0x90, 0xde, 0xea]);   // BCC $0570 / NOP
    const vram = peek(m, 0x570, 1);
    type(m, 'R PC 590\nT\n');
    check('T on a branch with one target in $00E0-$057F is an error', last(m).slice(-2), ['0590 BCC 0570', '?']);
    check('neither target was written', [peek(m, 0x592), peek(m, 0x570)], [[0xea], vram]);
    poke(m, 0x590, [0x90, 0x1e]);          // BCC $05B0(どちらも範囲の外)
    poke(m, 0x5b0, [0xea]);
    type(m, 'T\n');
    check('a branch with both targets outside steps normally', /^05(92|B0) /.test(last(m).at(-1)), true);
  }
  // JSR $01C0: T は中に入れないので ?。P はサブルーチンの中に BRK を置かないので進める
  {
    const m = boot();
    poke(m, 0x600, [0x20, 0xc0, 0x01, 0x60]);   // JSR $01C0 / RTS
    poke(m, 0x1c0, [0xe8, 0x60]);               // INX / RTS
    type(m, 'R X 0\nR PC 600\nT\n');
    check('T on JSR $01C0 is an error', last(m).slice(-2), ['0600 JSR 01C0', '?']);
    type(m, 'P\n');
    check('P runs JSR $01C0 in one go', last(m).slice(-3), ['A=00 X=01 Y=00', 'S=FD P=..-B....', '0603 RTS']);
  }
  // ブレークポイントの上から G するとき(1命令を T と同じに進める)も同じ
  {
    const m = boot();
    poke(m, 0x600, [0x4c, 0xfd, 0x01]);
    type(m, 'B 600\nG 600\n');
    check('G from a breakpoint on JMP $01FD is an error', last(m).slice(-2), ['0600 JMP 01FD', '?']);
    check('the breakpoint BRK is not left', peek(m, 0x600, 3), [0x4c, 0xfd, 0x01]);
  }
}

// B24-01: T・P が範囲の中の行き先で止まった(?)後も、一時 BRK の候補の数(TB_N)が残っていた。
// 次に止まったとき(G の RTS など)やリセットで、書いていない番地へ TB_SAVE(元のバイトのはずのもの)を書き戻した。
// 拒否した直後には何も変わらないので、その後の操作の後でメモリを調べる
console.log('B24-01: a refused step leaves nothing to restore');
{
  const TB_N = SYM.TB_N;
  // BCC $0570 / NOP: 行き先は $0570(VRAM。範囲の中)と $0592。$0600 は RTS だけ
  const setup = (m) => { poke(m, 0x590, [0x90, 0xde, 0xea]); poke(m, 0x600, [0x60]); };
  const after = (name, m, how) => {
    check(`${name}: TB_N is 0 after the refusal`, peek(m, TB_N), [0]);
    how(m);
    check(`${name}: $0592 is still NOP`, peek(m, 0x592), [0xea]);
  };
  const gRts = (m) => type(m, 'G 600\n');
  const reset = (m) => { m.reset(); frames(m, 10); };
  for (const cmd of ['T', 'P']) {
    { const m = boot(); setup(m); type(m, `R PC 590\n${cmd}\n`); after(`${cmd} then G 600`, m, gRts); }
    { const m = boot(); setup(m); type(m, `R PC 590\n${cmd}\n`); after(`${cmd} then reset`, m, reset); }
  }
  // 前にふつうの T をして、TB_SAVE に 0 でない値(LDA #7 の $A9)が残っているとき
  {
    const m = boot();
    setup(m);
    poke(m, 0x620, [0xea, 0xa9, 0x07]);   // NOP / LDA #7
    type(m, 'R PC 620\nT\n');
    check('a normal T before', last(m).at(-1), '0621 LDA #07');
    type(m, 'R PC 590\nT 3\n');
    check('then T 3 is refused', last(m).slice(-2), ['0590 BCC 0570', '?']);
    after('with an old TB_SAVE, then G 600', m, gRts);
    check('$0621 is still LDA #7', peek(m, 0x621, 2), [0xa9, 0x07]);
  }
  // ブレークポイントの上からの G が、1命令目で拒否されたとき
  {
    const m = boot();
    setup(m);
    type(m, 'B 590\nG 590\n');
    check('G from a breakpoint on BCC $0570 is refused', last(m).slice(-2), ['0590 BCC 0570', '?']);
    type(m, 'B -\n');
    after('G from a breakpoint, then G 600', m, gRts);
    check('$0590 is still BCC', peek(m, 0x590, 2), [0x90, 0xde]);
  }
}

// B24-01 の続き(0.11.18 のレビューの参考): 拒否の後に、それぞれの止まり方で止まっても書き戻さないこと。
// 止まり方はどれも mon_stop → remove_brks を通る(リセットは別の道で remove_brks を呼ぶ)。
// 先にふつうの T をして、TB_SAVE に 0 でない値($A9)を残しておく
console.log('B24-01: after a refused step, every way to stop restores nothing');
{
  const TB_N = SYM.TB_N;
  const stops = {
    'G to RTS': {
      prog: [0x60],                                  // RTS
      run: (m) => type(m, 'G 600\n'),
      want: (m) => out(m).slice(1)[1].startsWith('S=FF '),
    },
    'BRK': {
      prog: [0x00, 0xff],                            // BRK
      run: (m) => type(m, 'G 600\n'),
      want: (m) => last(m).at(-1).startsWith('0602 '),
    },
    'breakpoint': {
      prog: [0xe8, 0xe8, 0x60],                      // INX / INX / RTS
      run: (m) => type(m, 'B 601\nG 600\n'),
      want: (m) => last(m).at(-1) === '0601 INX',
    },
    'BREAK key': {
      prog: [0x78, 0x4c, 0x01, 0x06],                // SEI / JMP $0601
      run: (m) => { type(m, 'G 600\n'); frames(m, 10); m.pressBreak(); frames(m, 5); },
      want: (m) => last(m).at(-1) === '0601 JMP 0601',
    },
    'reset': {
      prog: [0x60],
      run: (m) => { m.reset(); frames(m, 10); },
      want: (m) => screen(m)[0] === 'PX-65 MONITOR',
    },
  };
  for (const cmd of ['T', 'P']) {
    for (const [name, st] of Object.entries(stops)) {
      const m = boot();
      poke(m, 0x590, [0x90, 0xde, 0xea]);   // BCC $0570 / NOP(行き先 $0570 は範囲の中)
      poke(m, 0x620, [0xea, 0xa9, 0x07]);   // NOP / LDA #7
      poke(m, 0x600, st.prog);
      type(m, 'R PC 620\nT\n');             // TB_SAVE に $A9 が残る
      type(m, `R PC 590\n${cmd}\n`);
      const refused = last(m).slice(-2).join('|') === '0590 BCC 0570|?' && peek(m, TB_N)[0] === 0;
      st.run(m);
      check(`${cmd}, then ${name}: refused, stopped, nothing written back`,
        [refused, st.want(m), peek(m, 0x590, 3), peek(m, 0x620, 3), peek(m, 0x600, st.prog.length)],
        [true, true, [0x90, 0xde, 0xea], [0xea, 0xa9, 0x07], st.prog]);
    }
  }
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
