// 機能テストでは確認できない部分のテスト:
// リセット、IRQ、NMI、BRK、WAI、STP、サイクル数
//
//   node test/interrupts.test.js

import { CPU65C02, F_B, F_D, F_I } from '../src/cpu65c02.js';

let failures = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}: expected ${expected}, got ${actual}`);
  }
}

// 64KBのRAMにプログラムとベクタを置いたCPUを作る
function machine(program, { at = 0x0200, irq = 0x0300, nmi = 0x0380 } = {}) {
  const mem = new Uint8Array(0x10000);
  mem.set(program, at);
  mem[0xfffc] = at & 0xff; mem[0xfffd] = at >> 8;
  mem[0xfffe] = irq & 0xff; mem[0xffff] = irq >> 8;
  mem[0xfffa] = nmi & 0xff; mem[0xfffb] = nmi >> 8;
  mem[irq] = 0x40; // IRQハンドラ: RTI
  mem[nmi] = 0x40; // NMIハンドラ: RTI
  const cpu = new CPU65C02({ read: (a) => mem[a], write: (a, v) => { mem[a] = v; } });
  cpu.reset();
  return { cpu, mem };
}

console.log('reset');
{
  const { cpu } = machine([0xea]);
  check('PC comes from $FFFC', cpu.pc, 0x0200);
  check('I flag is set', !!(cpu.p & F_I), true);
}

console.log('IRQ');
{
  // SED; NOP; CLI; NOP
  const { cpu, mem } = machine([0xf8, 0xea, 0x58, 0xea]);
  cpu.setIRQ(true);
  cpu.step(); cpu.step();
  check('masked while I is set', cpu.pc, 0x0202);
  cpu.step(); // CLI
  const cycles = cpu.step();
  check('serviced after CLI', cpu.pc, 0x0300);
  check('takes 7 cycles', cycles, 7);
  check('pushed P has B=0', mem[0x01fb] & F_B, 0);
  check('D is cleared in handler', cpu.p & F_D, 0);
  check('return address high', mem[0x01fd], 0x02);
  check('return address low', mem[0x01fc], 0x03);
  cpu.setIRQ(false);
  cpu.step(); // RTI
  check('RTI returns', cpu.pc, 0x0203);
  check('RTI restores D', !!(cpu.p & F_D), true);
}

console.log('NMI');
{
  // SEI; NOP; NOP
  const { cpu } = machine([0x78, 0xea, 0xea]);
  cpu.step();
  cpu.nmi();
  cpu.step();
  check('serviced even with I set', cpu.pc, 0x0380);
  cpu.step(); // RTI
  cpu.step();
  check('edge-triggered (runs once)', cpu.pc, 0x0202);
}

console.log('BRK');
{
  // BRK $42; NOP
  const { cpu, mem } = machine([0x00, 0x42, 0xea]);
  const cycles = cpu.step();
  check('jumps to IRQ vector', cpu.pc, 0x0300);
  check('takes 7 cycles', cycles, 7);
  check('pushed P has B=1', mem[0x01fb] & F_B, F_B);
  check('pushed PC skips signature byte', (mem[0x01fd] << 8) | mem[0x01fc], 0x0202);
}

console.log('WAI');
{
  // SEI; WAI; NOP; CLI; WAI; NOP
  const { cpu } = machine([0x78, 0xcb, 0xea, 0x58, 0xcb, 0xea]);
  cpu.step(); cpu.step();
  for (let i = 0; i < 10; i++) cpu.step();
  check('stays waiting', cpu.pc, 0x0202);
  check('waiting flag', cpu.waiting, true);
  cpu.setIRQ(true);
  cpu.step();
  check('IRQ with I set resumes without servicing', cpu.pc, 0x0203);
  cpu.setIRQ(false);
  cpu.step(); cpu.step(); // CLI; WAI
  cpu.step();
  check('still waiting', cpu.waiting, true);
  cpu.setIRQ(true);
  cpu.step();
  check('IRQ with I clear is serviced', cpu.pc, 0x0300);
}

console.log('STP');
{
  // STP; NOP
  const { cpu } = machine([0xdb, 0xea]);
  cpu.step();
  for (let i = 0; i < 10; i++) cpu.step();
  check('stays stopped', cpu.pc, 0x0201);
  cpu.nmi();
  cpu.step();
  check('NMI does not wake it', cpu.pc, 0x0201);
  cpu.reset();
  check('reset restarts', cpu.pc, 0x0200);
}

console.log('cycle counts');
{
  const cyclesOf = (program, setup = () => {}) => {
    const { cpu } = machine(program);
    setup(cpu);
    return cpu.step();
  };
  check('LDA abs,X no page cross = 4', cyclesOf([0xbd, 0x00, 0x10], (c) => { c.x = 0x10; }), 4);
  check('LDA abs,X page cross = 5', cyclesOf([0xbd, 0xf8, 0x10], (c) => { c.x = 0x10; }), 5);
  check('STA abs,X always 5', cyclesOf([0x9d, 0x00, 0x10], (c) => { c.x = 0x10; }), 5);
  check('LDA (zp),Y page cross = 6', cyclesOf([0xb1, 0x10], (c) => { c.y = 0xff; c.bus.write(0x10, 0x80); }), 6);
  check('branch not taken = 2', cyclesOf([0xd0, 0x10], (c) => { c.p |= 0x02; }), 2);
  check('branch taken = 3', cyclesOf([0xd0, 0x10], (c) => { c.p &= ~0x02; }), 3);
  check('branch taken, page cross = 4', cyclesOf([0x80, 0x80]), 4);
  check('ADC imm binary = 2', cyclesOf([0x69, 0x01]), 2);
  check('ADC imm decimal = 3', cyclesOf([0x69, 0x01], (c) => { c.p |= F_D; }), 3);
  check('JMP (abs) = 6', cyclesOf([0x6c, 0x00, 0x10]), 6);
  check('INC abs,X = 7', cyclesOf([0xfe, 0x00, 0x10]), 7);
  check('ASL abs,X no page cross = 6', cyclesOf([0x1e, 0x00, 0x10]), 6);
  check('ASL abs,X page cross = 7', cyclesOf([0x1e, 0xff, 0x10], (c) => { c.x = 1; }), 7);
  check('BBR taken = 6', cyclesOf([0x0f, 0x10, 0x05]), 6);
}

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
