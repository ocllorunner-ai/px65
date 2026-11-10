// ファジング: FILES(test/fuzz.js の files)
//
// でたらめなブロック(種類 B・M・ほかの値、名前、長さ)を並べたテープを入れ、ときどき BASIC の SAVE で足してから、
// FILES を打つ。3つ表示するごとにキーを待つので、でたらめなキー(RET、↓、SPACE で続き、ほかのキーで終わり、
// ときどき BREAK)を押す。テープの終わりを切る、見出しを壊す、後ろにごみを足す、なども混ぜる。
// テープのバイトを JavaScript で読んだ写し(docs/monitor.md の形式)から、表示を計算して比べる。
//   - 1つの行は「種類 名前(8文字) 長さ」。種類は B(BASIC)、M(メモリ)、ほかは ?
//   - 3つ表示するごとにキーを待つ(次のブロックがあるときだけ)。RET、↓、SPACE で続き、ほかのキーで終わり
//   - 空のテープは ?NT ERROR。見出しが PX で始まらない、見出しやデータの途中でテープが終わると ?TP ERROR
//     (データの終わりは、次の見出しを探すときに分かる。チェックサムは FILES では調べない)
// 改行の位置は見ない(行がちょうど16文字だと、画面の折り返しで改行が要らなくなるため)。

const CONT = ['\r', '\x14', ' '];

function block(type, name, start, data, goodSum = true) {
  const h = [0x50, 0x58, type, ...name, start & 255, start >> 8, data.length & 255, data.length >> 8, ...data];
  let s = 0;
  for (const v of h) s = (s + v) & 255;
  return [...h, goodSum ? s : (s + 1) & 255];
}

// テープを読んで、FILES が表示するはずの行と、終わり方を返す
export function readTape(t) {
  if (!t.length) return { entries: [], end: 'NT' };
  const entries = [];
  let pos = 0;
  for (;;) {
    if (pos >= t.length) return { entries, end: 'ok' };
    if (t.length - pos < 15 || t[pos] !== 0x50 || t[pos + 1] !== 0x58) return { entries, end: 'TP' };
    const type = t[pos + 2];
    const name = String.fromCharCode(...t.slice(pos + 3, pos + 11));
    const len = t[pos + 13] | (t[pos + 14] << 8);
    entries.push((type === 2 ? 'B' : type === 1 ? 'M' : '?') + ' ' + name + ' ' + len);
    pos += 15 + len + 1;
    if (pos > t.length) return { entries, end: 'TP' };   // 次を探すときに、データの途中で終わる
  }
}

// env: { b(), typed, fail(reason, extra) }
export function caseFiles(r, env) {
  const b = env.b();
  const typed = env.typed;
  // テープを作る
  let bytes = [];
  const n = r.int(0, 12);
  for (let k = 0; k < n; k++) {
    const type = r.pick([1, 2, 2, 1, 0, 3, 0x41, 0xff]);
    const nameLen = r.int(0, 8);
    const name = Array.from({ length: 8 }, (_, j) => (j < nameLen ? r.pick([...'ABCZ09 xy!-.$']).charCodeAt(0) : 32));
    const len = r.chance(0.15) ? r.int(1000, 20000) : r.int(0, 300);
    const data = Array.from({ length: len }, () => r.int(0, 255));
    bytes.push(...block(type, name, r.int(0, 0xffff), data, r.chance(0.9)));
  }
  switch (r.int(0, 9)) {
    case 0: if (bytes.length) bytes = bytes.slice(0, r.int(1, bytes.length - 1)); break;   // 途中で切る
    case 1: if (bytes.length) bytes[r.int(0, Math.min(bytes.length - 1, 40))] ^= 0x10; break;   // 先頭の近くを壊す
    case 2: bytes.push(...Array.from({ length: r.int(1, 20) }, () => r.int(0, 255))); break;   // 後ろにごみ
    default:
  }
  if (bytes.length > 65536) bytes = bytes.slice(0, 65536);
  b.m.bus.insertTape(Uint8Array.from(bytes));
  typed.push(`(tape: ${n} blocks, ${bytes.length} bytes)`);
  // ときどき BASIC の SAVE で足す(SAVE はテープの最後に足す。壊れたテープの後ろにも足せる)
  for (let k = r.chance(0.3) ? r.int(1, 2) : 0; k > 0; k--) {
    const nm = Array.from({ length: r.int(0, 10) }, () => r.pick([...'AB9 z'])).join('');
    const line = `SAVE "${nm}"`;
    typed.push(line);
    const o = b.run(line);
    if (o.endsWith('(timeout)')) return env.fail('SAVE did not end', JSON.stringify(o));
  }
  const { entries, end } = readTape(b.m.bus.tape);

  // FILES を打ち、キーを待っていたら押す
  typed.push('FILES');
  let out = b.run('FILES');
  const keys = [];
  for (let guard = 0; guard < 20; guard++) {
    if (out.endsWith('(timeout)')) return env.fail('FILES did not come back', JSON.stringify(out.slice(-80)));
    if (/>$/.test(out)) break;
    const key = r.chance(0.05) ? 'BREAK' : r.chance(0.8) ? r.pick(CONT) : r.pick(['X', 'q', '\x11', '\x13', '1']);
    keys.push(key);
    typed.push('  key ' + JSON.stringify(key));
    b.clearOut();
    if (key === 'BREAK') b.m.pressBreak(); else b.type(key);
    if (!b.settle(600)) return env.fail('FILES did not wait or end after a key');
    out += b.out;
  }
  // 写しの表示
  let want = 'FILES';
  let used = 0;
  let stopped = false;
  if (end === 'NT') want += '?NT ERROR';
  else {
    for (let k = 0; k < entries.length; k++) {
      if (k > 0 && k % 3 === 0) {
        const key = keys[used++];
        if (key === 'BREAK') { want += 'BREAK'; stopped = true; break; }
        if (!CONT.includes(key)) { stopped = true; break; }
      }
      want += entries[k];
    }
    if (!stopped && end === 'TP') want += '?TP ERROR';
  }
  want += '>';
  const got = out.replace(/\n/g, '');
  if (got !== want) return env.fail('unexpected FILES output', `got  ${JSON.stringify(got)}\nwant ${JSON.stringify(want)}`);
  if (used !== keys.length) return env.fail('FILES waited for a different number of keys', `${keys.length} keys typed, ${used} expected`);
  if (b.m.bus.tapeMode !== 0) return env.fail('the tape is still moving after FILES', String(b.m.bus.tapeMode));
}
