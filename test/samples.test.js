// サンプルのプログラム(samples/*.bas)が動くかのテスト
//   node test/samples.test.js

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootBasic } from './basic_harness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok    ${name}`); return; }
  failures++;
  console.log(`  FAIL  ${name}\n        expected ${e}\n        got      ${a}`);
}

// プログラムを打ち込む(エラーがあれば知らせる)
function load(name) {
  const b = bootBasic();
  const lines = readFileSync(join(root, 'samples', `${name}.bas`), 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const bad = lines.filter((l) => /ERROR/.test(b.run(l)));
  check(`${name}: entered without errors`, bad, []);
  b.clearOut();
  return b;
}
const dots = (b) => b.ram.subarray(0x400, 0x580).reduce((a, v) => a + v.toString(2).split('1').length - 1, 0);

console.log('HELLO');
{
  const b = load('HELLO');
  b.type('RUN\n');
  b.settle();
  b.type('TARO\n');
  b.settle();
  check('greets', b.out, 'RUNNAME? TAROHELLO, TARO!\n>');
}

console.log('KAZUATE');
{
  const b = load('KAZUATE');
  b.type('RUN\n');
  b.settle();
  let lo = 1, hi = 100, n = 0, last = '';
  while (n < 10) {                       // 二分探索で当てる
    const g = (lo + hi) >> 1;
    b.clearOut();
    b.type(`${g}\n`);
    b.settle();
    n++;
    last = b.out;
    if (last.includes('UP')) lo = g + 1;
    else if (last.includes('DOWN')) hi = g - 1;
    else break;
  }
  check('guessed within 7 tries', /OK! \d TRIES\n>$/.test(last) && n <= 7, true);
}

console.log('SINWAVE');
{
  const b = load('SINWAVE');
  b.type('RUN\n');
  b.cycles(12_000_000);
  check('shows the title and waits for a key (no prompt yet)', [b.out.endsWith('SIN COS\n'), b.idle()], [true, false]);
  check('drew the curves', dots(b) > 200, true);
  b.type(' ');
  b.settle();
  check('a key ends it', b.out.endsWith('>'), true);
}

console.log('BOUNCE');
{
  const b = load('BOUNCE');
  b.type('RUN\n');
  b.cycles(5_000_000);
  check('beeps at the walls', b.m.bus.beepEvents.length > 0, true);
  b.m.pressBreak();
  b.settle();
  check('BREAK stops it', /BREAK IN \d+\n>$/.test(b.out), true);
}

console.log('MUSIC');
{
  const b = load('MUSIC');
  b.type('RUN\n');
  check('plays to the end', b.settle(1000) && b.out, 'RUNTWINKLE TWINKLE\n>');
}

console.log('CATCH');
{
  const b = load('CATCH');
  b.type('RUN\n');
  b.cycles(500_000);
  const paddle = () => {
    for (let n = 0; n < 8; n++) {        // 描き直している途中なら少し待つ
      const xs = [];
      for (let x = 0; x < 96; x++) if (b.ram[0x400 + 3 * 96 + x] & 0x80) xs.push(x);
      if (xs.length) return xs[0];
      b.cycles(7000);
    }
    return -1;
  };
  check('paddle at the start', paddle(), 44);
  for (let i = 0; i < 3; i++) { b.type(String.fromCharCode(17)); b.cycles(200_000); }
  check('← moves it left', paddle(), 32);
  b.settle(1000);
  check('game over after 3 misses', /MISS 3 \nGAME OVER\n>$/.test(b.out), true);
}

console.log('ABC');
{
  const b = load('ABC');
  check('machine code prints A-Z', b.run('RUN'), 'RUNABCDEFGHIJKLMNOPQRSTUVWXYZ\n>');
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
