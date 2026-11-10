// 実行時の見張り(test/watch.js)そのもののテスト
//   node test/watch.test.js
//
// わざと違反する小さな ROM を動かして、見張りが見逃さないこと、許したものは報告しないことを確かめる。

import { assemble } from '../tools/asm.js';
import { Machine } from '../src/machine.js';
import { watchMachine, makeProfile, takeViolations, checkBasicMemory, PROFILE_PX65 } from './watch.js';
import { bootBasic, BSYM } from './basic_harness.js';
import { buildRom } from '../tools/rom.js';

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok    ${name}`); return; }
  failures++;
  console.log(`  FAIL  ${name}\n        expected ${e}\n        got      ${a}`);
}

let count = 0;
// body を $E000 から置いた ROM を、region の持ち物として動かし、違反の種類を返す
function run(region, body, steps = 200) {
  const src = `
        .org $E000
reset:
${body}
done:   bra done
brkv:   bra brkv
        .org $FFFA
        .word reset, reset, brkv
`;
  const asm = assemble(src, 'watch-test.s');
  const prof = makeProfile(`watch-test-${++count}`, [{ region, lo: 0xe000, hi: 0xffff, asm, exempt: false }]);
  const m = watchMachine(new Machine(), prof);
  m.loadROM(asm.mem.subarray(0xa000));
  m.powerOn();
  for (let i = 0; i < steps; i++) m.step();
  return { v: takeViolations().map((t) => t.replace(/:.*?: /, ': ').replace(/ \S+:\d+/, '')), m, asm };
}
const kinds = (r) => r.v.map((t) => t.split(':')[0]);

console.log('violations are detected');
check('write outside own area', run('monitor', 'ldx #0\nlp: sta $0800,X\n inx\n cpx #2\n bne lp').v,
  ['write: monitor code writes outside its area: $0800-$0801']);
check('basic code writes monitor area', kinds(run('basic', 'lda #1\n sta $0200')), ['write']);
check('write to ROM', run('monitor', 'sta $E000').v, ['write: writes ROM $E000']);
check('write to undefined I/O', kinds(run('monitor', 'sta $8040')), ['write']);
check('write to KEY_COL (read only)', kinds(run('monitor', 'sta $8001')), ['write']);
check('BASIC code writes KEY_ROW or TAPE_DATA', kinds(run('basic', 'sta $8000\n sta $8030')), ['write', 'write']);
check('BASIC code writes BEEP, LCD and TAPE_CTRL', run('basic', 'sta $8002\n sta $8003\n sta $8010\n sta $8020\n sta $8031').v, []);
check('BRK in ROM', kinds(run('monitor', 'brk\n nop')), ['brk']);
check('jump into the middle of an instruction', kinds(run('monitor', 'jmp mid+1\nmid: lda #$EA\n bra done')), ['exec']);
check('jump out of ROM', kinds(run('monitor', 'lda #$60\n sta $E0\n jmp $00E0')), ['leave']);
check('stack wraps', kinds(run('monitor', 'ldx #$FF\n txs\n pla')), ['stack']);

console.log('allowed things are not reported');
check('own area, stack, VRAM, I/O', run('monitor', 'lda #1\n sta $E0\n sta $0200\n sta $0300\n sta $0400\n sta $8002\n pha\n pla').v, []);
check('public BIOS area from BASIC (LINELEN, T_NAME, NMIVEC)', run('basic', 'lda #1\n sta $0250\n sta $02A1\n sta $02C4').v, []);
check('BASIC program area', run('basic', 'lda #1\n sta $0800\n sta $7FFF').v, []);
check('JSR/RTS out of ROM is fine with RTS', run('monitor', 'lda #$60\n sta $E0\n ldx #$FF\n txs\n jsr sub\n bra done\nsub: rts').v, []);

console.log('exempt ranges allow only indirect or indexed writes');
{
  const src = `
        .org $E000
reset:  ldx #0
poke:   lda #1
        sta $0800,X     ; 添字の書き込み: 許す
        sta $0801       ; 直接の書き込み: 許さない
clr:    sta $0200,X     ; 宛先 $0200-$02FF だけ許す
        sta $0580,X
done:   bra done
        .org $FFFA
        .word reset, reset, reset
`;
  const asm = assemble(src, 'exempt-test.s');
  const prof = makeProfile('exempt-test', [{ region: 'monitor', lo: 0xe000, hi: 0xffff, asm,
    exemptList: [{ region: 'monitor', label: 'poke', what: 'write' }, { region: 'monitor', label: 'clr', what: 'write', dest: [0x200, 0x2ff] }] }]);
  const m = watchMachine(new Machine(), prof);
  m.loadROM(asm.mem.subarray(0xa000));
  m.powerOn();
  for (let i = 0; i < 20; i++) m.step();
  check('reported', takeViolations().map((t) => t.replace(/:.*?: /, ': ').replace(/ \S+:\d+/, '')),
    ['write: monitor code writes outside its area: $0801', 'write: monitor code writes outside its area: $0580']);
}

console.log('profiles (a different ROM is never mistaken for a cached one)');
{
  // 前は、名前と行の数が同じなら、別の ROM でも前に作ったプロファイルを返した
  const a = assemble('.org $E000\nnop\nnop\n', 'a.s');
  const b = assemble('.org $E000\nlda #0\nnop\n', 'b.s');
  const b2 = assemble('.org $E000\nlda #0\nnop\n', 'b.s');
  const part = (asm) => [{ region: 'monitor', lo: 0xe000, hi: 0xffff, asm, exempt: false }];
  const pa = makeProfile('same-name-test', part(a));
  check('the same assembly gives the same profile', makeProfile('same-name-test', part(a)) === pa, true);
  let err = '';
  try { makeProfile('same-name-test', part(b)); } catch (e) { err = e.message; }
  check('the same name for a different ROM is an error', /different ROM/.test(err), true);
  const pb = makeProfile('other-name-test', part(b));
  check('instruction starts of the other ROM', [pb.start[0xe000], pb.start[0xe001], pb.start[0xe002]], [1, 0, 1]);
  check('the same bytes assembled again can share the name', makeProfile('other-name-test', part(b2)).start[0xe002], 1);
}

console.log('profiles follow changes of the exempt settings (T14-01)');
{
  // 前は、同じ名前・同じ asm で exemptList だけを変えると、前の設定のプロファイルを返した
  const asm = assemble('.org $E000\nreset: ldx #0\npoke: sta $0800,X\nnext: bra next\n.org $FFFA\n.word reset, reset, reset\n', 't14.s');
  const base = { region: 'monitor', lo: 0xe000, hi: 0xffff, asm };
  const runWith = (prof) => {
    const m = watchMachine(new Machine(), prof);
    m.loadROM(asm.mem.subarray(0xa000));
    m.powerOn();
    for (let i = 0; i < 10; i++) m.step();
    return takeViolations().length;
  };
  const allow = [{ region: 'monitor', label: 'poke', what: 'write' }];
  check('allowed', runWith(makeProfile('t14', [{ ...base, exemptList: allow }])), 0);
  check('the same settings again reuse the profile',
    makeProfile('t14', [{ ...base, exemptList: [{ region: 'monitor', label: 'poke', what: 'write' }] }]) ===
    makeProfile('t14', [{ ...base, exemptList: allow }]), true);
  check('removing the permission', runWith(makeProfile('t14', [{ ...base, exemptList: [] }])), 1);
  check('adding it back', runWith(makeProfile('t14', [{ ...base, exemptList: allow }])), 0);
  check('dest that does not include $0800', runWith(makeProfile('t14', [{ ...base,
    exemptList: [{ region: 'monitor', label: 'poke', what: 'write', dest: [0x200, 0x2ff] }] }])), 1);
  allow[0].dest = [0x800, 0x8ff];   // 同じ配列の中身を書き換える
  check('a change inside the same array', runWith(makeProfile('t14', [{ ...base, exemptList: allow }])), 0);
  allow[0].dest = [0x900, 0x9ff];
  check('another change inside the same array', runWith(makeProfile('t14', [{ ...base, exemptList: allow }])), 1);
}

console.log('coverage');
{
  const r = run('monitor', 'ldx #3\nlp: dex\n bne lp\n beq never\n nop\nnever: nop');
  const S = r.asm.symbols;
  const cov = r.m.watchCoverage;
  check('executed', (cov[S.LP] & 1) === 1, true);
  check('bne both ways', cov[S.LP + 1] & 6, 6);
  check('beq only taken', cov[S.LP + 3] & 6, 2);
}

console.log('BASIC memory records');
{
  const b = bootBasic();
  b.lines('10 PRINT 1', '20 PRINT 2', 'A=1');
  const prof = PROFILE_PX65(buildRom());
  check('a good program passes', checkBasicMemory(b.m, prof, BSYM), []);
  const v = b.ram[BSYM.VARTAB];
  b.ram[BSYM.VARTAB] = v - 1;
  check('vartab before the end of the program', checkBasicMemory(b.m, prof, BSYM).length > 0, true);
  b.ram[BSYM.VARTAB] = v;
  b.ram[0x800] += 1;                // 10行目のつなぎを1つずらす
  check('a broken link', checkBasicMemory(b.m, prof, BSYM).some((t) => /^line 10 /.test(t)), true);
  b.ram[0x800] -= 1;
  b.ram[0x7ff] = 1;
  check('$07FF must be 0', checkBasicMemory(b.m, prof, BSYM), ['$07FF is not 0']);
  b.ram[0x7ff] = 0;
  takeViolations();
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
