// ファジングの道具(test/fuzz.js)の prog が作るプログラムの形を調べるテスト
//   node test/fuzz_gen.test.js [prog の数] [機械語のプログラムの数]
//
// prog は「必ず終わる」プログラムを作る前提で、終わらなければ ROM の失敗として報告する。
// その前提が崩れると、正しい ROM でも失敗が出る(T20-01)。ここでは、作ったプログラムを実行せずに、
// 終わることの理由になっている形の決まり(checkProgram)を守っているかを、たくさんの種で調べる。
// mon の G・T・P が作る機械語のプログラム(test/fuzz_mon_run.js)も、写しで動かして同じように調べる。

import { makeProgram, rng } from './fuzz.js';
import { makeAnswer } from './fuzz_input.js';
import { prepare, RunModel, TestBug } from './fuzz_mon_run.js';

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) { console.log(`  ok    ${name}`); return; }
  failures++;
  console.log(`  FAIL  ${name} ${detail}`);
}

// 形の決まりを調べて、守っていないところの一覧を返す。
// 今の生成器(makeProgram)が作る文の形に向けた検査で、どんな BASIC のプログラムでも終わるかを判定するものではない。
//   - 行番号は増えていく
//   - GOTO・ON GOTO・IF THEN 行番号 は後ろのメインの行(END の行まで)へ。サブルーチンへは飛ばない
//   - GOSUB の行き先はサブルーチンの行で、GOSUB より後ろ
//   - サブルーチンがあるなら、その前に END だけの行がある。END の行より後ろは全部サブルーチン
//   - サブルーチンの行は RETURN で終わり、FOR・NEXT・GOTO・ON・IF・REM・' を含まない
//   - FOR の変数は、FOR の外で書き換えない(代入や READ の左辺にしない)
const FOR_VARS = ['I', 'J', 'K'];
export function checkProgram(lines) {
  const problems = [];
  const parsed = lines.map((l) => {
    const m = l.match(/^(\d+) (.*)$/);
    // 文字列の中は調べないので、空にしておく
    return { no: Number(m[1]), text: m[2], code: m[2].replace(/"[^"]*"/g, '""') };
  });
  for (let k = 1; k < parsed.length; k++) if (parsed[k].no <= parsed[k - 1].no) problems.push(`line numbers not increasing at ${parsed[k].no}`);
  // サブルーチンの前の END の行: END だけの行のうち、後ろに行があるもの(メインの最後の行が END だけのこともある)
  const endIdx = parsed.findLastIndex((p, k) => p.text === 'END' && k < parsed.length - 1);
  const subStart = endIdx >= 0 ? endIdx + 1 : parsed.length;
  const isSub = (no) => parsed.findIndex((p) => p.no === no) >= subStart;
  const mainNos = new Set(parsed.slice(0, subStart).map((p) => p.no));   // END の行も含む
  parsed.forEach((p, k) => {
    const where = `line ${p.no}`;
    // REM と ' の後ろは見ない(コメント)
    const code = p.code.replace(/(\bREM\b|').*$/, '');
    for (const m of code.matchAll(/\b(GOTO|THEN) (\d+(?:,\d+)*)/g)) {
      for (const t of m[2].split(',').map(Number)) {
        if (!(t > p.no && mainNos.has(t))) problems.push(`${where}: ${m[1]} ${t} is not a later main line`);
      }
    }
    for (const m of code.matchAll(/\bGOSUB (\d+)/g)) {
      const t = Number(m[1]);
      if (!(t > p.no && isSub(t))) problems.push(`${where}: GOSUB ${t} is not a later subroutine line`);
    }
    // FOR の変数の書き換え。文の頭は行の頭、: の後、THEN と ELSE の後
    // 代入: 文の頭の「変数 =」(FOR I= は FOR で始まるので当たらない)
    for (const m of code.matchAll(/(?:^|:|\bTHEN\b|\bELSE\b)\s*([A-Z][A-Z0-9]*)\s*=/g)) {
      if (FOR_VARS.includes(m[1])) problems.push(`${where}: assigns the FOR variable ${m[1]}`);
    }
    // READ: 文の終わり(: か ELSE か行の終わり)までの、書き込み先の変数をすべて調べる(T21-01)。
    // ELSE で区切らないと、IF A THEN READ B ELSE READ I の ELSE の後の READ を見落とす
    for (const m of code.matchAll(/(?:^|:|\bTHEN\b|\bELSE\b)\s*READ\b((?:(?!\bELSE\b)[^:])*)/g)) {
      for (const target of m[1].split(',')) {
        const name = target.trim().match(/^[A-Z][A-Z0-9]*/)?.[0];
        if (FOR_VARS.includes(name) && !/^[A-Z][A-Z0-9]*\$/.test(target.trim())) problems.push(`${where}: READ writes the FOR variable ${name}`);
      }
    }
    if (k >= subStart) {
      if (!/(^|:)RETURN$/.test(p.text)) problems.push(`${where}: subroutine does not end with RETURN`);
      if (/\b(FOR|NEXT|GOTO|ON|IF|REM)\b|'/.test(p.code)) problems.push(`${where}: subroutine has FOR, NEXT, GOTO, ON, IF, REM or '`);
    } else if (/\bRETURN\b/.test(code)) {
      problems.push(`${where}: RETURN outside the subroutines`);
    }
  });
  // GOSUB があるのに END の行がない(サブルーチンへ落ちてしまう)
  if (endIdx < 0 && parsed.some((p) => /\bGOSUB\b/.test(p.code))) problems.push('GOSUB without an END line before the subroutines');
  return problems;
}

// 1. レビュー(T20-01)の、0.11.10 の道具が作れた終わらないプログラム。決まりを守っていないと分かること
console.log('known bad programs');
{
  const bad = ['10 CLS:RAD:FOR I=3 TO 4', '20 GOSUB 60', '30 NEXT I', '40 GOTO 90', '50 GOSUB 80',
    "60 ' X:RETURN", '70 FOR I=-1 TO 4', '80 PRINT 4:RETURN', '90 PRINT 0:NEXT I'];
  const p = checkProgram(bad);
  check('T20-01 program is rejected', p.length > 0, JSON.stringify(p));
  // 種 1110 の prog:883(0.11.10 の確認で終わらなかったもの)
  const bad2 = ['18 CLS:RAD:Y=ATN(RIGHT$(B$,215.24E-34)=B$(3))', '20 GOSUB 128', '28 FOR I=3 TO 4:GOSUB 128:LINE 90,-18,-18,48',
    '52 GOSUB 119', '77 S$=(("-&H8523")):DATA 9939.24064143," ":NEXT', '89 RESTORE',
    '119 FOR I=-1 TO 4:B$="52E-313":LINE -8,14,28,37:RETURN', '127 CIRCLE 67,27,27,2:PRINT 3:PRINT HEX$(B)',
    '128 RESTORE:RETURN', '154 ON 1 GOTO 166,166:RESTORE 77', '166 P(4)=1:S$="1":S$="80322792827773668":NEXT I'];
  const p2 = checkProgram(bad2);
  check('seed 1110 prog:883 program is rejected', p2.length > 0, JSON.stringify(p2));
  // FOR の変数を READ や代入で書き換える(T21-01)。どれも終わらないことがある
  const forBase = ['10 DATA 0', '20 FOR I=1 TO 2'];
  const rejected = [
    [...forBase, '30 RESTORE:READ I', '40 NEXT I', '50 END'],
    ['10 DATA 7,0', '20 FOR I=1 TO 2', '30 RESTORE:READ A,I', '40 NEXT I', '50 END'],
    ['10 READ J'], ['10 READ K'], ['10 READ A,J,B'], ['10 PRINT 1:READ A$, K'],
    ['10 IF A THEN I=5'], ['10 IF A THEN PRINT 1 ELSE J=2'], ['10 K=1'],
    ['10 IF A THEN READ B ELSE READ I'], ['10 IF A THEN READ I ELSE READ B'], ['10 IF A THEN READ B,C ELSE READ D:READ K'],
  ];
  for (const p of rejected) check(`rejects ${p.slice(-3).join(' / ')}`, checkProgram(p).length > 0);
  const accepted = [['10 IF A THEN READ B ELSE READ C'], ['10 READ A,B$'], ['10 READ A:PRINT I'], ['10 FOR I=1 TO 2:NEXT I'], ['10 READ I$'], ['10 PRINT "READ I"'], ['10 IF I=1 THEN PRINT I']];
  for (const p of accepted) check(`accepts ${p.join(' / ')}`, checkProgram(p).length === 0, JSON.stringify(checkProgram(p)));
  // IF の条件が成り立たないと RETURN を飛ばす
  check('IF in a subroutine is rejected', checkProgram(['10 GOSUB 30', '20 END', '30 IF 0 THEN PRINT "T":RETURN']).length > 0);
  // 決まりを守ったもの
  const good = ['10 CLS:RAD:FOR I=1 TO 3:GOSUB 40', '20 NEXT I:IF A THEN 30', '30 PRINT "X:Y"', '35 END', '40 PRINT I:GOSUB 50:RETURN', '50 DATA 1,"A:B":RETURN'];
  check('a good program is accepted', checkProgram(good).length === 0, JSON.stringify(checkProgram(good)));
}

// 2. makeProgram が作るプログラムが、いつも決まりを守ること
console.log('generated programs');
{
  const N = Number(process.argv[2] ?? 20000);
  let bad = 0, first = '', withSubs = 0, nestedGosub = 0;
  for (let i = 0; i < N; i++) {
    const { nums, lines } = makeProgram(rng(`gen:${i}`));
    if (lines.length !== nums.length) { bad++; if (!first) first = `case ${i}: ${lines.length} lines for ${nums.length} numbers`; continue; }
    if (lines.some((l) => / END$/.test(l))) withSubs++;
    if (lines.some((l) => /GOSUB/.test(l) && /:RETURN$/.test(l))) nestedGosub++;
    const p = checkProgram(lines);
    if (p.length) { bad++; if (!first) first = `case ${i}: ${p[0]}\n        ${lines.join('\n        ')}`; }
  }
  check(`${N} programs follow the rules`, bad === 0, `${bad} bad. first: ${first}`);
  // 決まりの検査が空回りしていないこと(サブルーチンや、サブルーチンの中の GOSUB も作られている)
  check(`subroutines are generated (${withSubs})`, withSubs > N / 3);
  check(`GOSUB inside subroutines is generated (${nestedGosub})`, nestedGosub > 0);
}

// 3. input の答えの行が、どれも58文字以内であること(1行は58文字まで。超えると、写しのエコーと画面が合わなくなる。T22-01)
console.log('input answers');
{
  // 長くなりやすい「文字列の変数が3つ」を多めにする(0.11.13 の生成器は、まれに58文字を超えた。この数なら見つかる)
  const N = 200000;
  let longest = 0, first = '';
  for (let i = 0; i < N; i++) {
    const r = rng(`ans:${i}`);
    const pending = r.chance(0.5) ? ['str', 'str', 'str'] : Array.from({ length: r.int(1, 3) }, () => (r.chance(0.5) ? 'num' : 'str'));
    const a = makeAnswer(r, pending);
    if (a.length > longest) { longest = a.length; if (a.length > 58 && !first) first = JSON.stringify(a); }
  }
  check(`${N} answers are at most 58 characters (longest ${longest})`, longest <= 58, `first: ${first}`);
  check('long answers are generated too', longest >= 50);
}

// 4. mon の G・T・P が作る機械語のプログラム(test/fuzz_mon_run.js)
// 写し(RunModel)で、G で最後まで動かすと必ず止まり(RTS、BRK、自分へのジャンプ)、決めた範囲の外を読み書きしないこと。
// T と P で1命令ずつ最後まで進めても、同じ止まり方をすること(同じ CPU コアなので、レジスタも同じになる)。
// 範囲の外を読み書きしたり、止まらなかったりすると、RunModel が TestBug を投げる
console.log('machine-code programs');
{
  const N = Number(process.argv[3] ?? 5000);
  let bad = 0, first = '';
  const ends = { rts: 0, brk: 0, break: 0 };
  let longest = 0, steps = 0;
  for (let i = 0; i < N; i++) {
    const r = rng(`run:${i}`);
    const where = `case ${i}`;
    try {
      const { C, W, asm, lines } = prepare(r);
      longest = Math.max(longest, asm.bytes.length);
      const mem = new Uint8Array(0x10000);
      for (let a = 0; a < 0x8000; a++) mem[a] = r.int(0, 255);
      for (const l of lines) l.apply((a, v) => { mem[a] = v; });
      const regs = { a: r.int(0, 255), x: r.int(0, 255), y: r.int(0, 255), s: 0xff, p: r.int(0, 255), pc: C };
      const mem0 = mem.slice();
      const g = new RunModel(mem, C, asm.bytes.length, W, asm.starts, asm.selfAt);
      g.setRegs(regs, true);
      const st = g.go([]);
      ends[st.ev]++;
      // T か P で1命令ずつ(自分へのジャンプの手前まで)
      const mem2 = mem0.slice();
      const t = new RunModel(mem2, C, asm.bytes.length, W, asm.starts, asm.selfAt);
      t.setRegs(regs, true);
      const over = r.chance(0.5);
      let s2 = null;
      for (let n = 0; n < 100000; n++) {
        if (t.cpu.pc === asm.selfAt) { s2 = { ...t.stop('break') }; break; }
        s2 = t.step(over, 1);
        steps++;
        if (s2.ev !== 'step') break;
      }
      const same = s2 && s2.ev === st.ev && s2.a === st.a && s2.x === st.x && s2.y === st.y && s2.s === st.s && (s2.p & 0xef) === (st.p & 0xef)
        && mem2.every((v, a) => v === mem[a]);
      if (!same) throw new TestBug(`stepping gives a different end: ${JSON.stringify(s2)} vs ${JSON.stringify(st)}`);
    } catch (e) {
      if (!(e instanceof TestBug)) throw e;
      bad++;
      if (!first) first = `${where}: ${e.message}`;
    }
  }
  check(`${N} programs stop inside their areas`, bad === 0, `${bad} bad. first: ${first}`);
  check(`every way to stop is generated (${JSON.stringify(ends)})`, ends.rts > N / 4 && ends.brk > N / 10 && ends.break > N / 10);
  check(`programs are not too long (longest ${longest} bytes)`, longest < 300);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
