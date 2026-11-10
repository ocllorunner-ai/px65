// Klaus Dormannのテスト4つをまとめて実行する
//
//   git clone https://github.com/Klaus2m5/6502_65C02_functional_tests.git ../6502tests
//   node test/klaus.js ../6502tests          (npm run test:cpu -- ../6502tests でも同じ)
//
//   1. 6502_functional_test.bin       6502 の全命令(10進モードを含む)       成功は $3469
//   2. 65C02_extended_opcodes_test.bin 65C02 で増えた命令、RMB/SMB/BBR/BBS、
//                                      未定義の命令が NOP になること            成功は $24F1
//                                      (wdc_op = 1 なので WAI/STP は調べない。WAI/STP は
//                                       test/interrupts.test.js で調べている)
//   3. 6502_decimal_test.a65          10進モードの全組み合わせ(65C02、A と NVZC のフラグ)
//   4. 6502_interrupt_test.a65        IRQ、NMI、BRK と、割り込みで D が消えること
//                                     (passed0 まで。その後ろの手で操作する WAI/STP のテストは実行しない)
// 成功のアドレスは、リポジトリのコミット 7954e2d(2020-01-05)の bin_files/*.lst で確かめた。

import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node test/klaus.js <6502_65C02_functional_tests のフォルダ>');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const runs = [
  ['6502 functional', 'functional.js', [join(dir, 'bin_files/6502_functional_test.bin'), '3469']],
  ['65C02 extended opcodes', 'functional.js', [join(dir, 'bin_files/65C02_extended_opcodes_test.bin'), '24F1']],
  ['decimal mode (65C02, all flags)', 'decimal.js', [join(dir, '6502_decimal_test.a65'), '1', 'all']],
  ['interrupts', 'interrupt.js', [join(dir, '6502_interrupt_test.a65')]],
];
let failed = 0;
for (const [name, script, args] of runs) {
  const r = spawnSync(process.execPath, [join(here, script), ...args], { encoding: 'utf8' });
  const msg = (r.stdout + r.stderr).trim().split('\n').pop();
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'}  ${name}: ${msg}`);
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
