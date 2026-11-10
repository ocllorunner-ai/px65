// メモリマップとI/Oのテスト
//   node test/bus.test.js

import { readFileSync } from 'node:fs';
import { assemble } from '../tools/asm.js';
import { Machine } from '../src/machine.js';
import {
  Bus, KEY_ROW, KEY_COL, LCD_ANN, LCD_CTRL, TIMER_CTRL, BEEP, TIMER_PERIOD, LCD_WIDTH,
  TAPE_DATA, TAPE_CTRL, TAPE_MAX,
} from '../src/bus.js';

let failures = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    const hex = (v) => (typeof v === 'number' ? `$${v.toString(16).toUpperCase()}` : String(v));
    console.log(`  FAIL  ${name}: expected ${hex(expected)}, got ${hex(actual)}`);
  }
}

// アセンブリのソースから16KBのROMを作る
function romFrom(source) {
  const r = assemble(source);
  return r.mem.subarray(0xc000, 0x10000);
}

console.log('memory map');
{
  const bus = new Bus();
  bus.loadROM(new Uint8Array([0x11, 0x22]));
  bus.write(0x0000, 0x12); bus.write(0x7fff, 0x34);
  check('RAM start', bus.read(0x0000), 0x12);
  check('RAM end', bus.read(0x7fff), 0x34);
  bus.write(0x8100, 0x55);
  check('unused area reads $FF', bus.read(0x8100), 0xff);
  check('unused area end reads $FF', bus.read(0x9fff), 0xff);
  check('undefined I/O reads $FF', bus.read(0x8080), 0xff);
  check('I/O is at $8000', bus.read(0x8003), 0x00);
  check('short ROM is aligned to the end', bus.read(0xfffe), 0x11);
  check('short ROM last byte', bus.read(0xffff), 0x22);
  check('ROM padding is $FF', bus.read(0xa000), 0xff);
  bus.write(0xffff, 0x00);
  check('ROM is not writable', bus.read(0xffff), 0x22);
  bus.loadROM(new Uint8Array(0x6000).fill(0x33));
  check('24KB ROM starts at $A000', bus.read(0xa000), 0x33);
  let threw = false;
  try { bus.loadROM(new Uint8Array(0x6001)); } catch { threw = true; }
  check('ROM over 24KB is rejected', threw, true);
}

console.log('keyboard matrix');
{
  const bus = new Bus();
  bus.setKey(2, 5, true);
  bus.write(KEY_ROW, 0b11111011);
  check('pressed key in selected row', bus.read(KEY_COL), 0b11011111);
  bus.write(KEY_ROW, 0b11111101);
  check('other row sees nothing', bus.read(KEY_COL), 0xff);
  bus.setKey(1, 0, true);
  bus.write(KEY_ROW, 0b11111001);
  check('two rows selected at once', bus.read(KEY_COL), 0b11011110);
  bus.setKey(2, 5, false);
  bus.write(KEY_ROW, 0b11111011);
  check('released key', bus.read(KEY_COL), 0xff);
  bus.write(KEY_ROW, 0xff);
  check('no row selected', bus.read(KEY_COL), 0xff);
}

console.log('timer');
{
  const bus = new Bus();
  bus.tick(TIMER_PERIOD - 1);
  check('not yet pending', bus.read(TIMER_CTRL), 0x00);
  bus.tick(1);
  check('pending after 15,625 cycles', bus.read(TIMER_CTRL), 0x80);
  check('no IRQ while disabled', bus.irq, false);
  bus.write(TIMER_CTRL, 0x01);
  check('IRQ when enabled', bus.irq, true);
  check('reads enable and pending', bus.read(TIMER_CTRL), 0x81);
  bus.write(TIMER_CTRL, 0x81);
  check('writing bit7 clears pending', bus.read(TIMER_CTRL), 0x01);
  check('IRQ released', bus.irq, false);
}

console.log('beeper');
{
  const bus = new Bus();
  bus.tick(100);
  bus.write(BEEP, 1);
  bus.write(BEEP, 1);
  bus.tick(50);
  bus.write(BEEP, 0);
  check('records only changes', bus.beepEvents.length, 2);
  check('first change cycle', bus.beepEvents[0].cycle, 100);
  check('second change cycle', bus.beepEvents[1].cycle, 150);
  check('second change level', bus.beepEvents[1].level, 0);
}

console.log('LCD');
{
  const bus = new Bus();
  bus.write(0x0400 + 1 * 96 + 10, 0b00000100); // ページ1、x=10、bit2 → y=10
  bus.write(LCD_ANN, 0x05);
  check('annunciator register', bus.read(LCD_ANN), 0x05);
  check('display off shows nothing', bus.renderLCD()[10 * LCD_WIDTH + 10], 0);
  bus.write(LCD_CTRL, 0x91);
  check('display on', bus.renderLCD()[10 * LCD_WIDTH + 10], 1);
  check('neighbour stays off', bus.renderLCD()[9 * LCD_WIDTH + 10], 0);
  check('contrast', bus.contrast, 9);
  bus.resetIO();
  check('reset turns the display off', bus.read(LCD_CTRL), 0);
}

console.log('machine');
{
  const m = new Machine();
  m.loadROM(romFrom(`
        .org $C000
reset:  lda #$81
        sta $8010       ; タイマー割り込みを有効に
        cli
loop:   bra loop
irq:    inc $10
        lda #$81
        sta $8010
        rti
nmi:    inc $11
        rti
        .org $FFFA
        .word nmi, reset, irq
  `));
  m.bus.ram[0x20] = 0x99;
  m.powerOn();
  check('power on clears RAM', m.bus.ram[0x20], 0);
  // 64Hzのタイマーは15/16秒ごとにフレームの境界と重なるので、重ならない61フレームで数える
  for (let f = 0; f < 61; f++) m.runFrame();
  check('61 frames = 65 timer IRQs', m.bus.ram[0x10], 65);
  const total = m.cpu.cycles - 7; // リセットの7サイクルを除く
  check('61 frames is about 1,016,667 cycles', Math.abs(total - 1_016_667) < 10, true);
  m.pressBreak();
  m.runFrame();
  check('BREAK runs the NMI handler', m.bus.ram[0x11], 1);
  m.bus.ram[0x20] = 0x77;
  m.powerOn({ keepRAM: true });
  check('keepRAM leaves RAM alone', m.bus.ram[0x20], 0x77);
}

console.log('test ROM');
{
  const m = new Machine();
  m.loadROM(readFileSync(new URL('../rom/test_pattern.bin', import.meta.url)));
  m.powerOn();
  for (let f = 0; f < 20; f++) m.runFrame();
  const lcd = m.bus.renderLCD();
  check('top-left corner', lcd[0], 1);
  check('bottom-right corner', lcd[31 * LCD_WIDTH + 95], 1);
  check('inside is blank', lcd[2 * LCD_WIDTH + 2], 0);
  check('cursor off at 20 frames', lcd[10 * LCD_WIDTH + 86], 0);
  for (let f = 0; f < 30; f++) m.runFrame();
  check('cursor on at 50 frames', m.bus.renderLCD()[10 * LCD_WIDTH + 86], 1);

  // SHIFT(行3、列4)を押す → 左端の表示、SHIFT表示、ビープ
  m.bus.beepEvents.length = 0;
  m.bus.setKey(3, 4, true);
  for (let f = 0; f < 10; f++) m.runFrame(); // ビープは約0.1秒(6フレーム)
  check('key shown at x=4+row, y=8+col', m.bus.renderLCD()[(8 + 4) * LCD_WIDTH + 4 + 3], 1);
  check('SHIFT annunciator', m.bus.read(LCD_ANN) & 0x02, 0x02);
  check('beep toggles about 400 times', Math.abs(m.bus.beepEvents.length - 400) <= 2, true);
  const ev = m.bus.beepEvents;
  const freq = 1_000_000 / (ev[2].cycle - ev[0].cycle);
  check('beep is about 2kHz', freq > 1800 && freq < 2200, true);
  m.bus.setKey(3, 4, false);
  for (let f = 0; f < 2; f++) m.runFrame();
  check('key released', m.bus.renderLCD()[(8 + 4) * LCD_WIDTH + 4 + 3], 0);
  check('SHIFT annunciator off', m.bus.read(LCD_ANN), 0);
}

console.log('virtual tape');
{
  const bus = new Bus();
  check('stopped at power on', bus.read(TAPE_CTRL), 0x00);
  bus.write(TAPE_CTRL, 0x01);
  check('empty tape: playing and end of tape', bus.read(TAPE_CTRL), 0x41);
  check('reading past the end gives $FF', bus.read(TAPE_DATA), 0xff);

  let recorded = null;
  bus.onTapeRecorded = (bytes) => { recorded = Array.from(bytes); };
  bus.write(TAPE_CTRL, 0x02);
  check('recording', bus.read(TAPE_CTRL), 0x02);
  for (const v of [0x10, 0x20, 0x30]) bus.write(TAPE_DATA, v);
  check('not reported until stopped', recorded, null);
  bus.write(TAPE_CTRL, 0x00);
  check('stop reports the recording', JSON.stringify(recorded), '[16,32,48]');
  check('stopped', bus.read(TAPE_CTRL), 0x00);
  check('reading while stopped gives $FF', bus.read(TAPE_DATA), 0xff);

  bus.write(TAPE_CTRL, 0x01);
  check('data ready', bus.read(TAPE_CTRL), 0x81);
  check('peek does not advance', bus.peek(TAPE_DATA), 0x10);
  check('first byte', bus.read(TAPE_DATA), 0x10);
  check('second byte', bus.read(TAPE_DATA), 0x20);
  bus.write(TAPE_CTRL, 0x01);
  check('PLAY again rewinds', bus.read(TAPE_DATA), 0x10);
  bus.read(TAPE_DATA); bus.read(TAPE_DATA);
  check('end of tape after the last byte', bus.read(TAPE_CTRL), 0x41);
  bus.write(TAPE_DATA, 0x99);
  check('writing while playing is ignored', bus.tape.length, 3);

  bus.insertTape(new Uint8Array([7, 8]));
  check('insertTape stops the tape', bus.read(TAPE_CTRL), 0x00);
  bus.write(TAPE_CTRL, 0x01);
  check('inserted tape plays', bus.read(TAPE_DATA), 7);

  bus.write(TAPE_CTRL, 0x03);
  check('APPEND records', bus.read(TAPE_CTRL), 0x02);
  bus.write(TAPE_DATA, 9);
  bus.write(TAPE_CTRL, 0x00);
  check('APPEND keeps the old contents', JSON.stringify(Array.from(bus.tape)), '[7,8,9]');

  bus.write(TAPE_CTRL, 0x02);
  bus.write(TAPE_DATA, 0x55);
  bus.resetIO();
  check('reset stops recording and keeps it', JSON.stringify(Array.from(bus.tape)), '[85]');

  bus.write(TAPE_CTRL, 0x02);
  for (let i = 0; i < TAPE_MAX + 10; i++) bus.write(TAPE_DATA, i & 0xff);
  bus.write(TAPE_CTRL, 0x00);
  check('recording is limited to 64KB', bus.tape.length, TAPE_MAX);

  // いっぱいになったら FULL($20)が立つ。CANCEL($04)で録音前の中身に戻る
  bus.insertTape(new Uint8Array(TAPE_MAX - 2).fill(7));
  bus.write(TAPE_CTRL, 0x03);
  bus.write(TAPE_DATA, 1);
  bus.write(TAPE_DATA, 2);
  check('not full while it fits', bus.read(TAPE_CTRL), 0x02);
  bus.write(TAPE_DATA, 3);
  check('FULL after a byte is dropped', bus.read(TAPE_CTRL), 0x22);
  bus.write(TAPE_CTRL, 0x04);
  check('CANCEL stops the tape', bus.read(TAPE_CTRL), 0x00);
  check('CANCEL keeps the tape as before recording', `${bus.tape.length},${bus.tape[TAPE_MAX - 3]}`, `${TAPE_MAX - 2},7`);
  bus.write(TAPE_CTRL, 0x03);
  check('FULL is cleared by the next command', bus.read(TAPE_CTRL), 0x02);
  bus.write(TAPE_CTRL, 0x00);
  let threw = false;
  try { bus.insertTape(new Uint8Array(TAPE_MAX + 1)); } catch { threw = true; }
  check('too large a tape is rejected', threw, true);
}

console.log('tape in saved state');
{
  const m = new Machine();
  m.bus.insertTape(new Uint8Array([1, 2, 3]));
  m.bus.write(TAPE_CTRL, 0x01);
  m.bus.read(TAPE_DATA);
  const state = JSON.parse(JSON.stringify(m.saveState()));
  const m2 = new Machine();
  m2.loadState(state);
  check('tape contents restored', JSON.stringify(Array.from(m2.bus.tape)), '[1,2,3]');
  check('tape position restored', m2.bus.read(TAPE_DATA), 2);
  delete state.tape;
  m2.loadState(state);
  check('old state without tape gives an empty tape', m2.bus.tape.length, 0);
  let threw = false;
  try { m2.loadState({ ...state, version: 1 }); } catch { threw = true; }
  check('version 1 state (16KB ROM, I/O at $BF00) is rejected', threw, true);
}

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
