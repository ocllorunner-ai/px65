// 配布するファイルがソースから作り直したものと同じかのテスト
//   node test/dist.test.js
//
// rom/px65.bin、rom/monitor.bin、samples/samples.tap、dist/ の2ファイルは、ソースを変えたら
// 作り直す必要がある(npm run rom、npm run monitor、npm run samples、npm run build)。
// 作り直し忘れをここで見つける。

import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRom } from '../tools/rom.js';
import { buildAll } from '../tools/build.js';
import { buildSamplesTape } from '../tools/mksamples.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, ok, hint) {
  if (ok) { console.log(`  ok    ${name}`); return; }
  failures++;
  console.log(`  FAIL  ${name}  (${hint})`);
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const file = (p) => readFileSync(join(root, p));

console.log('ROM files are up to date');
check('rom/px65.bin', same(file('rom/px65.bin'), buildRom().bin), 'npm run rom で作り直す');
{
  const dir = mkdtempSync(join(tmpdir(), 'px65-'));
  try {
    const out = join(dir, 'monitor.bin');
    execFileSync(process.execPath, [join(root, 'tools/asm.js'), join(root, 'rom/monitor.s'), '-o', out, '--range', 'A000:FFFF'], { stdio: 'pipe' });
    check('rom/monitor.bin', same(file('rom/monitor.bin'), readFileSync(out)), 'npm run monitor で作り直す');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('samples/samples.tap is up to date');
check('samples/samples.tap', same(file('samples/samples.tap'), buildSamplesTape()), 'npm run samples で作り直す');

console.log('dist/ is up to date');
for (const [path, { html }] of Object.entries(buildAll('rom/px65.bin'))) {
  check(path, file(path).toString('utf8') === html, 'npm run build で作り直す');
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
