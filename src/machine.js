// PX-65 エミュレーター: 本体(CPUとバスをつなぐ)
//
//   const m = new Machine();
//   m.loadROM(romBytes);
//   m.powerOn();
//   m.runFrame();          // 1/60秒ぶん実行
//   m.bus.renderLCD();     // 画面のドット

import { CPU65C02 } from './cpu65c02.js';
import { Bus, CPU_HZ } from './bus.js';

export const FPS = 60;

export class Machine {
  constructor() {
    this.bus = new Bus();
    this.cpu = new CPU65C02(this.bus);
    this.cycleDebt = 0; // 1フレームの端数(16,666.67サイクル)を持ち越す
  }

  loadROM(data) { this.bus.loadROM(data); }

  // 電源投入。keepRAM が true ならRAMの内容を残す
  powerOn({ keepRAM = false } = {}) {
    if (!keepRAM) this.bus.clearRAM();
    this.reset();
  }

  // リセット(RAMはそのまま)
  reset() {
    this.bus.resetIO();
    this.cpu.reset();
    this.cpu.setIRQ(false);
  }

  // BREAKキー
  pressBreak() { this.cpu.nmi(); }

  // 1命令を実行し、かかったサイクル数を返す
  step() {
    const c = this.cpu.step();
    this.bus.tick(c);
    this.cpu.setIRQ(this.bus.irq);
    return c;
  }

  // 指定したサイクル数だけ実行する(命令の途中では止まらないので少し超えることがある)
  runCycles(cycles) {
    let done = 0;
    while (done < cycles) done += this.step();
    return done;
  }

  // 1フレーム(1/60秒)ぶん実行し、実行したサイクル数を返す。
  // breakpoints(アドレスのSet)を渡すと、PCがそのどれかに来たところで止まり、breakHit が true になる
  runFrame(breakpoints = null) {
    this.cycleDebt += CPU_HZ / FPS;
    this.breakHit = false;
    let done = 0;
    while (done < this.cycleDebt) {
      if (breakpoints && breakpoints.has(this.cpu.pc)) {
        this.breakHit = true;
        this.cycleDebt = 0;
        return done;
      }
      done += this.step();
    }
    this.cycleDebt -= done;
    return done;
  }

  // ---- 状態の保存と復元(JSONにできる形) ----

  saveState() {
    const { cpu, bus } = this;
    return {
      version: 2, // 2: ROMが24KB、I/Oが $8000 になった
      cpu: { a: cpu.a, x: cpu.x, y: cpu.y, s: cpu.s, p: cpu.p, pc: cpu.pc, cycles: cpu.cycles,
        nmiPending: cpu.nmiPending, waiting: cpu.waiting, stopped: cpu.stopped },
      bus: { keyRow: bus.keyRow, lcdAnn: bus.lcdAnn, lcdCtrl: bus.lcdCtrl, timerEnable: bus.timerEnable,
        timerPending: bus.timerPending, timerCount: bus.timerCount, beepLevel: bus.beepLevel, cycles: bus.cycles },
      ram: toBase64(bus.ram),
      rom: toBase64(bus.rom),
      tape: { data: toBase64(bus.tape), mode: bus.tapeMode, pos: bus.tapePos, rec: toBase64(Uint8Array.from(bus.tapeRec)), full: bus.tapeFull },
    };
  }

  loadState(state) {
    if (!state || state.version !== 2) throw new Error('unsupported state');
    Object.assign(this.cpu, state.cpu);
    Object.assign(this.bus, state.bus);
    this.bus.ram.set(fromBase64(state.ram));
    this.bus.rom.set(fromBase64(state.rom));
    this.bus.beepEvents.length = 0;
    // テープは後から加えたので、ないときは空のテープにする
    const tape = state.tape;
    this.bus.tape = tape ? fromBase64(tape.data) : new Uint8Array(0);
    this.bus.tapeMode = tape ? tape.mode : 0;
    this.bus.tapePos = tape ? tape.pos : 0;
    this.bus.tapeRec = tape ? Array.from(fromBase64(tape.rec)) : [];
    this.bus.tapeFull = tape?.full ?? false;
    this.cpu.setIRQ(this.bus.irq);
    this.cycleDebt = 0;
  }
}

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
