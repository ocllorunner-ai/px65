// キー入力の列(web/keyqueue.js)のテスト
//   node test/keyqueue.test.js
//
// UI と同じように、押す・離すを列に入れ、フレームごとに process() してキーマトリクスに反映する。
// 状態を読み込んで時間が戻っても、キー入力が止まらないことを確かめる。

import { KeyQueue, KEY_POSITION, HOLD_CYCLES } from '../web/keyqueue.js';
import { bootBasic } from './basic_harness.js';

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok    ${name}`); return; }
  failures++;
  console.log(`  FAIL  ${name}\n        expected ${e}\n        got      ${a}`);
}

// 押されているキーの名前を返す、時刻だけを持つバス
function fakeBus() {
  const on = new Set();
  return {
    cycles: 0,
    setKey(r, c, v) { const k = `${r},${c}`; if (v) on.add(k); else on.delete(k); },
    pressed() {
      return [...KEY_POSITION].filter(([, [r, c]]) => on.has(`${r},${c}`)).map(([n]) => n);
    },
  };
}

console.log('timing');
{
  const bus = fakeBus();
  const q = new KeyQueue(bus, KEY_POSITION);
  bus.cycles = 1000;
  q.push(true, 'A', null, true);
  q.push(false, 'A', null, true);
  check('pressed at once', bus.pressed(), ['A']);
  bus.cycles += HOLD_CYCLES - 1;
  q.process(true);
  check('held until read twice', bus.pressed(), ['A']);
  bus.cycles += 1;
  q.process(true);
  check('then released', bus.pressed(), []);
  q.push(true, 'A', null, true);
  check('pressed again only after a gap', bus.pressed(), []);
}

console.log('time goes back (state loaded)');
for (const withReset of [false, true]) {
  const label = withReset ? 'with reset()' : 'without reset()';
  const bus = fakeBus();
  const q = new KeyQueue(bus, KEY_POSITION);
  bus.cycles = 10_000_000;                   // 状態を保存してからしばらくたって A を押して離す
  q.push(true, 'A', null, true);
  bus.cycles += HOLD_CYCLES;
  q.push(false, 'A', null, true);
  bus.cycles = 100_000;                      // 保存した状態を読み込む(時間が戻る)
  if (withReset) q.reset();
  q.push(true, 'A', null, true);
  check(`${label}: the same key works at once`, bus.pressed(), ['A']);
  bus.cycles += HOLD_CYCLES;
  q.push(false, 'A', null, true);
  q.push(true, 'B', null, true);
  check(`${label}: another key follows`, bus.pressed(), ['B']);
  bus.cycles += HOLD_CYCLES;
  q.push(false, 'B', null, true);
  q.push(true, '*', true, true);             // ":"(SHIFT + ×)
  check(`${label}: a SHIFT symbol works`, bus.pressed().sort(), ['*', 'SHIFT']);
}

console.log('typing into BASIC after loading a state');
{
  const b = bootBasic();
  const q = new KeyQueue(b.m.bus, KEY_POSITION);
  const frame = () => b.cycles(16667);          // 1フレーム(表示した文字を集めながら)
  // UI と同じく、フレームごとに process() しながら1文字ずつ打つ
  const type = (text) => {
    for (const ch of text) {
      const SYM = { '\n': ['RET', null], ' ': ['SPACE', null], ':': ['*', true], '?': ['/', true] };
      const [name, shift] = SYM[ch] ?? [ch, null];
      q.push(true, name, shift, true);
      for (let f = 0; f < 2; f++) { frame(); q.process(true); }
      q.push(false, name, shift, true);
      for (let f = 0; f < 3; f++) { frame(); q.process(true); }
    }
    for (let f = 0; f < 120 && q.queue.length; f++) { frame(); q.process(true); }
    for (let f = 0; f < 30; f++) frame();
  };
  const state = JSON.parse(JSON.stringify(b.m.saveState()));
  for (let f = 0; f < 600; f++) frame();   // 10秒たってから
  type('A=1\n');
  b.m.loadState(state);                           // 保存した状態に戻す(UI と同じく列も戻す)
  q.reset();
  b.clearOut();
  type('?1:?2\n');
  check('typed right after loading', b.out, '?1:?2 1 \n 2 \n>');
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
