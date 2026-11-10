// BASIC のテスト用の道具
//
//   const b = bootBasic();
//   b.run('PRINT 1+2');        // 打って実行し、表示された文字を返す(" 3 \n>" など)
//   b.lines('10 A=1', '20 PRINT A', 'RUN')

import { buildRom } from '../tools/rom.js';
import { Machine } from '../src/machine.js';
import { watchMachine, PROFILE_PX65, checkBasicMemory } from './watch.js';

const ROM = buildRom();
export const BSYM = ROM.basic.symbols;
export const MSYM = ROM.monitor.symbols;
export const ROM_BIN = ROM.bin;

const PUTC = MSYM.PUTC;
const GK_WAIT = MSYM.GK_WAIT;   // getkey の WAI(キーを待っているところ)
const KBUF = MSYM.KBUF;
const KB_HEAD = MSYM.KB_HEAD;
const KB_TAIL = MSYM.KB_TAIL;

export function bootBasic({ machine } = {}) {
  const m = machine ?? new Machine();
  if (!machine) {
    watchMachine(m, PROFILE_PX65(ROM));
    m.loadROM(ROM_BIN);
    m.powerOn();
  }
  let out = '';
  const ram = m.bus.ram;

  // 指定したサイクル数だけ動かす(表示された文字を集める)
  function cycles(n) {
    let done = 0;
    while (done < n) {
      if (m.cpu.pc === PUTC) {
        // 割り込みが入ると PUTC の命令を実行しないまま戻ってくるので、
        // 最初の命令(PHA、1バイト)を実行したときだけ数える
        const c = m.cpu.a;
        done += m.step();
        if (m.cpu.pc === PUTC + 1) out += c === 13 ? '\n' : String.fromCharCode(c);
        continue;
      }
      done += m.step();
    }
  }
  // キーを待っている状態か
  const idle = () => m.cpu.waiting && m.cpu.pc === GK_WAIT + 1 && ram[KB_HEAD] === ram[KB_TAIL];
  // キーを待つまで動かす
  // 入力を待っているときは、BASIC のメモリの使い方の記録も確かめる(test/watch.js)
  function settle(maxFrames = 3000) {
    for (let f = 0; f < maxFrames; f++) {
      cycles(16667);
      if (idle()) {
        if (inBasic()) checkBasicMemory(m, PROFILE_PX65(ROM), BSYM);
        return true;
      }
    }
    return false;
  }
  // BASIC がプロンプトで入力を待っているか(MON でモニターに入っているとき、INPUT の途中などは調べない)
  const inBasic = () => !ram[MSYM.MON_ACTIVE] && (ram[BSYM.BSTATE] === 0 || ram[BSYM.BSTATE] === 4);
  // キーバッファに文字を入れる(\n は RET)
  function typeRaw(text) {
    for (const ch of text) {
      const code = ch === '\n' ? 13 : ch.charCodeAt(0);
      // バッファが空くまで動かす
      for (;;) {
        const tail = ram[KB_TAIL];
        const next = (tail + 1) & 15;
        if (next !== ram[KB_HEAD]) {
          ram[KBUF + tail] = code;
          ram[KB_TAIL] = next;
          break;
        }
        cycles(2000);
      }
    }
  }
  settle();
  out = '';
  return {
    m,
    ram,
    // 1行を打って実行し、そのあいだの表示を返す
    run(line, maxFrames) {
      out = '';
      typeRaw(line + '\n');
      const ok = settle(maxFrames);
      return ok ? out : out + '(timeout)';
    },
    lines(...ls) {
      let all = '';
      for (const l of ls) all += this.run(l);
      return all;
    },
    type(text) { typeRaw(text); },
    settle,
    cycles,
    get out() { return out; },
    clearOut() { out = ''; },
    idle,
  };
}

// 表示から、入力した行のエコーを除いた結果の行を取り出す
// "PRINT 1\n 1 \n>" -> [" 1 "]
export function results(text) {
  const lines = text.split('\n');
  return lines.slice(1, -1).map((l) => l.trimEnd());
}
