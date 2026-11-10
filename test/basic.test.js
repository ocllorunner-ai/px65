// PX-65 BASIC のテスト
//   node test/basic.test.js
//
// キーバッファに文字を入れて BASIC を動かし、表示された文字(CHROUT に渡された文字)を比べる。

import { bootBasic, BSYM } from './basic_harness.js';
import { takeViolations } from './watch.js';
import { encodeFloat, decodeFloat } from '../tools/mkfpconst.js';
import { readFileSync, readdirSync } from 'node:fs';

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok    ${name}`); return; }
  failures++;
  console.log(`  FAIL  ${name}\n        expected ${e}\n        got      ${a}`);
}

// 1行を実行して、表示された結果(入力のエコーとプロンプトを除く)を返す
function out(b, line, maxFrames) {
  const s = b.run(line, maxFrames);
  // エコーの後ろから、最後のプロンプトの前まで
  let body = s.startsWith(line) ? s.slice(line.length) : s;
  if (body.endsWith('\n>')) body = body.slice(0, -2);
  else if (body.endsWith('>')) body = body.slice(0, -1);
  return body;
}

console.log('start');
{
  const b = bootBasic();
  const scr = b.m.bus.ram.subarray(0x400, 0x580);
  check('boots into BASIC', scr.some((v) => v !== 0), true);
  check('free bytes', out(b, 'PRINT FRE(0)'), ' 30717 ');
  check('RAD is lit', b.m.bus.lcdAnn & 0x18, 0x10);
}

console.log('numbers');
{
  const b = bootBasic();
  check('arithmetic', out(b, 'PRINT 1+2;7-10;6*7;7/2;2^10'), ' 3 -3  42  3.5  1024 ');
  check('precedence', out(b, 'PRINT 2+3*4;(2+3)*4;-2^2;2^-1;10-2-3'), ' 14  20 -4  .5  5 ');
  check('fractions', out(b, 'PRINT 1/3;2/3;.1+.2;1/7'), ' .333333333  .666666667  .3  .142857143 ');
  check('E notation', out(b, 'PRINT 1E9;1.5E-7;-2E20;1E38'), ' 1E+09  1.5E-07 -2E+20  1E+38 ');
  check('small decimals', out(b, 'PRINT .5;.05;.005;123.456'), ' .5  .05  5E-03  123.456 ');
  check('hex literal', out(b, 'PRINT &HFF;&H1000;&HFFFF'), ' 255  4096  65535 ');
  check('comparisons', out(b, 'PRINT 1<2;2<1;2>=2;3<>3;"A"<"B"'), '-1  0 -1  0 -1 ');
  check('logic', out(b, 'PRINT 12 AND 10;12 OR 3;NOT 5;NOT -1'), ' 8  15 -6  0 ');
  check('overflow', out(b, 'PRINT 1E38*10'), '?OV ERROR');
  check('division by zero', out(b, 'PRINT 1/0'), '?/0 ERROR');
}

console.log('number formatting (random, against JavaScript)');
{
  const b = bootBasic();
  // JavaScript で同じ規則の表示を作る(有効数字9桁)
  const fmt = (v) => {
    if (v === 0) return ' 0';
    const sign = v < 0 ? '-' : ' ';
    let a = Math.abs(v);
    let e = Math.floor(Math.log10(a));
    let digits = Math.round(a / 10 ** (e - 8));
    if (digits >= 1e9) { digits /= 10; e++; }
    if (digits < 1e8) { digits *= 10; e--; }
    let d = String(digits).replace(/0+$/, '') || '0';
    const E = e + 1;
    if (E >= 1 && E <= 9) {
      return sign + (d.length <= E ? d + '0'.repeat(E - d.length) : d.slice(0, E) + '.' + d.slice(E));
    }
    if (E === 0 || E === -1) return sign + '.' + '0'.repeat(-E) + d;
    const x = E - 1;
    return sign + d[0] + (d.length > 1 ? '.' + d.slice(1) : '') + 'E' + (x < 0 ? '-' : '+') + String(Math.abs(x)).padStart(2, '0');
  };
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let bad = 0, first = '', n = 0;
  for (let i = 0; i < 40; i++) {
    // 値をメモリに直接置いて表示させる(入力の変換と切り分けるため)
    const v = decodeFloat(encodeFloat((rnd() - 0.5) * 10 ** Math.floor(rnd() * 24 - 12)));
    const bytes = encodeFloat(v);
    b.run('X=0');
    // 変数 X の値の場所(最初の変数なので vartab + 2)
    const vt = b.ram[BSYM.VARTAB] | (b.ram[BSYM.VARTAB + 1] << 8);
    b.ram.set(bytes, vt + 2);
    const got = out(b, 'PRINT X').trimEnd();
    const want = fmt(v);
    n++;
    // 9桁目は丸めの境目で1つずれてもよい
    if (got !== want) {
      const gv = Number(got), wv = Number(want);
      if (!(Math.abs(gv - wv) <= Math.abs(wv) * 1.5e-9)) {
        if (!bad) first = `${v}: got "${got}" want "${want}"`;
        bad++;
      }
    }
    b.run('CLEAR');
  }
  check(`${n} values`, bad, 0);
  if (bad) console.log('        ' + first);
  check('reading numbers back (VAL)', out(b, 'PRINT VAL("1.25E3");VAL(" -7.5");VAL("ABC");VAL(".5E")'), ' 1250 -7.5  0  .5 ');
}

console.log('math functions');
{
  const b = bootBasic();
  const nums = (line) => out(b, line).trim().split(/\s+/).map(Number);
  // 9桁目の誤差は許す
  const near = (got, want, rel = 3e-9) => got.length === want.length && got.every((g, i) => Math.abs(g - want[i]) <= Math.abs(want[i]) * rel + 1e-9);
  const cases = [
    ['PRINT SQR(2);SQR(1E10);SQR(.25)', [Math.SQRT2, 1e5, 0.5]],
    ['PRINT SIN(1);COS(1);TAN(1)', [Math.sin(1), Math.cos(1), Math.tan(1)]],
    ['PRINT SIN(-100);COS(1000)', [Math.sin(-100), Math.cos(1000)]],
    ['PRINT SIN(1E5);COS(-1E6);TAN(1E5)', [Math.sin(1e5), Math.cos(-1e6), Math.tan(1e5)]],
    ['PRINT SIN(123456789);COS(-987654321)', [Math.sin(123456789), Math.cos(-987654321)]],
    ['PRINT SIN(6.7E9);SIN(-6.7E9)', [Math.sin(6.7e9), Math.sin(-6.7e9)]],
    // q = INT(x × 2/π) が1ずれる値(報告された例)
    ['PRINT SIN(-5845072722);SIN(5845072722)', [Math.sin(-5845072722), Math.sin(5845072722)]],
    ['PRINT COS(-3600886407);TAN(-5845072722)', [Math.cos(-3600886407), Math.tan(-5845072722)]],
    ['DEG:PRINT SIN(1000030);COS(-1000030):RAD', [Math.sin(310 * Math.PI / 180), Math.cos(310 * Math.PI / 180)]],
    ['DEG:PRINT SIN(2.4E10);SIN(.5):RAD', [Math.sin(240 * Math.PI / 180), Math.sin(0.5 * Math.PI / 180)]],
    ['PRINT ATN(1);ATN(-.3);ATN(50)', [Math.atan(1), Math.atan(-0.3), Math.atan(50)]],
    ['PRINT EXP(1);EXP(-3.5);EXP(40)', [Math.E, Math.exp(-3.5), Math.exp(40)]],
    ['PRINT LN(2);LN(1E-20);LOG(5)', [Math.LN2, Math.log(1e-20), Math.log10(5)]],
    ['PRINT 2^.5;3^-2;1.5^10', [Math.SQRT2, 1 / 9, 1.5 ** 10]],
  ];
  for (const [line, want, rel] of cases) {
    const got = nums(line);
    check(line, near(got, want, rel) ? 'close' : got, 'close');
  }
  {
    // 大きな引数をまとめて調べる(x = n × 2^k で、入力の数を正確に表す)
    let seed = 7, worst = 0;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 60; i++) {
      const v = Math.floor(rnd() * 6.6e9) * (i % 2 ? -1 : 1);
      const u = 2 ** Math.max(0, Math.floor(Math.log2(Math.abs(v))) - 31);
      const n = Math.round(v / u), x = n * u;
      const [sn, cs] = nums(`PRINT SIN(${n}*${u});COS(${n}*${u})`);
      worst = Math.max(worst, Math.abs(sn - Math.sin(x)), Math.abs(cs - Math.cos(x)));
    }
    check('SIN COS of 60 large arguments within 3E-9', worst < 3e-9 ? 'close' : worst, 'close');
  }
  {
    // 0 に近い角度: 符号と相対誤差を調べる(負の角度を 360 度や π/2 の近くへ移すと桁が落ちていた)
    const relNear = (got, want) => got.length === want.length && got.every((g, i) => Math.abs(g - want[i]) <= Math.abs(want[i]) * 6e-9); // 表示の9桁の丸めを含む
    const d = Math.PI / 180;
    const small = [
      ['PRINT SIN(-1E-10);SIN(1E-10);TAN(-1E-10);TAN(1E-10)', [-1e-10, 1e-10, -1e-10, 1e-10]],
      ['PRINT SIN(-1E-8);SIN(-1E-9);SIN(-1E-30);TAN(-1E-30)', [-1e-8, -1e-9, -1e-30, -1e-30]],
      ['PRINT SIN(-.001);TAN(-.001);COS(-1E-10)', [Math.sin(-0.001), Math.tan(-0.001), 1]],
      ['DEG:PRINT SIN(-1E-10);TAN(-1E-10);SIN(1E-10):RAD', [-1e-10 * d, -1e-10 * d, 1e-10 * d]],
      ['DEG:PRINT SIN(-.001);TAN(-.001);COS(-1E-10):RAD', [Math.sin(-0.001 * d), Math.tan(-0.001 * d), 1]],
    ];
    for (const [line, want] of small) {
      const got = nums(line);
      check(line, relNear(got, want) ? 'close' : got, 'close');
    }
    check('1/SIN(-1E-10)', nums('PRINT 1/SIN(-1E-10)'), [-1e10]);
    // SIN と TAN は奇関数、COS は偶関数
    let sym = true;
    for (const x of ['1E-20', '.3', '2', '100.25', '1234.5', '4E9']) {
      const [a, b2, c, e] = nums(`PRINT SIN(${x});SIN(-${x});TAN(${x});TAN(-${x})`);
      const [f, g] = nums(`PRINT COS(${x});COS(-${x})`);
      if (a !== -b2 || c !== -e || f !== g) sym = false;
    }
    check('SIN TAN odd, COS even', sym, true);
  }
  check('exact integer powers', out(b, 'PRINT 2^29;10^8;(-3)^3;7^0;2^-3'), ' 536870912  100000000 -27  1  .125 ');
  check('INT ABS SGN PI', out(b, 'PRINT INT(-2.5);INT(2.5);ABS(-4);SGN(-3);SGN(0);PI'), '-3  2  4 -1  0  3.14159265 ');
  check('DEG', out(b, 'DEG:PRINT SIN(30);COS(60);ATN(1);TAN(45)'), ' .5  .5  45  1 ');
  check('DEG annunciator', b.m.bus.lcdAnn & 0x18, 0x08);
  // 度では 90 度ずつ正確に分けるので、ちょうどの角度は 0 になり、TAN(90) は /0
  check('DEG exact zeros', out(b, 'PRINT COS(90);SIN(180);COS(270);SIN(360);SIN(-180)'), ' 0  0  0  0  0 ');
  check('DEG exact values', out(b, 'PRINT SIN(90);COS(180);SIN(270);SIN(150);COS(240)'), ' 1 -1 -1  .5 -.5 ');
  check('DEG TAN', out(b, 'PRINT TAN(180);TAN(-180);TAN(45);TAN(-45);TAN(135)'), ' 0  0  1 -1 -1 ');
  check('DEG TAN(90) TAN(-90) TAN(270) are /0', [out(b, 'PRINT TAN(90)'), out(b, 'PRINT TAN(-90)'), out(b, 'PRINT TAN(270)')], ['?/0 ERROR', '?/0 ERROR', '?/0 ERROR']);
  check('DEG large multiple of 90', out(b, 'PRINT SIN(36000090);COS(36000090)'), ' 1  0 ');
  {
    // 90 度の近く(x = 90 - 2^-13 など、正確に表せる値)でも相対誤差が小さい
    const d = Math.PI / 180, e = 2 ** -13;
    const got = nums('PRINT COS(90-2^-13);TAN(90-2^-13);SIN(360-2^-20)');
    const want = [Math.cos((90 - e) * d), Math.tan((90 - e) * d), -Math.sin(2 ** -20 * d)];
    check('DEG near 90 and 360', got.every((g, i) => Math.abs(g - want[i]) <= Math.abs(want[i]) * 6e-9) ? 'close' : got, 'close');
  }
  check('DEG: 2.5E10 degrees and more is ?FC', out(b, 'PRINT SIN(2.5E10)'), '?FC ERROR');
  b.run('RAD');
  check('6.8E9 radians and more is ?FC', [out(b, 'PRINT SIN(6.8E9)'), out(b, 'PRINT COS(-1E10)'), out(b, 'PRINT TAN(1E12)')], ['?FC ERROR', '?FC ERROR', '?FC ERROR']);
  check('errors', [out(b, 'PRINT SQR(-1)'), out(b, 'PRINT LN(0)'), out(b, 'PRINT (-2)^.5'), out(b, 'PRINT 0^-1')],
    ['?FC ERROR', '?FC ERROR', '?FC ERROR', '?/0 ERROR']);
  const r = nums('PRINT RND(1);RND(1);RND(0)');
  check('RND in [0,1), RND(0) repeats', r.every((v) => v >= 0 && v < 1) && r[1] === r[2] && r[0] !== r[1], true);
  const r1 = nums('X=RND(-5):PRINT RND(1);RND(1)');
  const r2 = nums('X=RND(-5):PRINT RND(1);RND(1)');
  check('RND(-n) reseeds', r1, r2);
}

console.log('strings');
{
  const b = bootBasic();
  check('functions', out(b, 'A$="HELLO":PRINT LEFT$(A$,2);RIGHT$(A$,2);MID$(A$,2,3)'), 'HELO ELL'.replace(' ', ''));
  check('MID$ without length, past end', out(b, 'PRINT MID$("ABC",2);"/";MID$("ABC",9);"/";LEFT$("AB",9)'), 'BC//AB');
  check('LEN ASC CHR$', out(b, 'PRINT LEN("ABC");ASC("A");CHR$(66);LEN("")'), ' 3  65 B 0 ');
  check('STR$ VAL', out(b, 'PRINT STR$(12);"/";VAL("3.5")+1'), ' 12/ 4.5 ');
  check('HEX$', out(b, 'PRINT HEX$(255);" ";HEX$(4096);" ";HEX$(0);" ";HEX$(-1)'), 'FF 1000 0 FFFF');
  check('INSTR', out(b, 'A$="ABCABC":PRINT INSTR(A$,"CA");INSTR(4,A$,"C")'), ' 3  6 ');
  check('INSTR not found', out(b, 'PRINT INSTR("AB","X");INSTR("AB","")'), ' 0  1 ');
  check('concatenation and compare', out(b, 'B$="XY":C$=B$+B$+"Z":PRINT C$;C$>"XYX";C$="XYXYZ"'), 'XYXYZ-1 -1 ');
  check('lower case kept in strings', out(b, 'PRINT "aBc"'), 'aBc');
  check('type mismatch', [out(b, 'A$=1'), out(b, 'A=""'), out(b, 'PRINT "A"*2')], ['?TM ERROR', '?TM ERROR', '?TM ERROR']);
  check('too long', out(b, 'A$=LEFT$("X",1):FOR I=1 TO 9:A$=A$+A$:NEXT'), '?LS ERROR');
}

console.log('garbage collection');
{
  const b = bootBasic();
  ['10 DIM A$(20)', '20 FOR I=1 TO 2000', '30 A$(I-INT(I/21)*21)=STR$(I)+"ABCDEFGHIJ"', '40 NEXT',
    '50 S=0:FOR I=0 TO 20:S=S+VAL(A$(I)):NEXT', '60 PRINT S;FRE(0)>29000'].forEach((l) => b.run(l));
  // 最後に残るのは 1980-2000 の21個(それぞれ i mod 21 の位置)
  let s = 0;
  for (let i = 1980; i <= 2000; i++) s += i;
  check('2000 strings in a loop', out(b, 'RUN', 30000), ` ${s} -1 `);
  b.run('NEW');
  ['10 A$=""', '20 FOR I=1 TO 200:A$=A$+"*":IF LEN(A$)>100 THEN A$=""', '30 B$=A$+"!":NEXT', '40 PRINT LEN(A$);LEN(B$)'].forEach((l) => b.run(l));
  check('growing string', out(b, 'RUN', 30000), ' 99  100 ');
}

console.log('variables and arrays');
{
  const b = bootBasic();
  check('two-letter names', out(b, 'AB=1:ABC=2:A1=3:PRINT AB;A1'), ' 2  3 ');
  check('array without DIM (0-10)', out(b, 'Z(10)=5:PRINT Z(10);Z(0)'), ' 5  0 ');
  check('beyond 10', out(b, 'PRINT Z(11)'), '?BS ERROR');
  check('2D array', out(b, 'DIM M(3,4):M(3,4)=7:M(1,2)=8:PRINT M(3,4);M(1,2);M(2,1)'), ' 7  8  0 ');
  check('string array', out(b, 'DIM S$(2):S$(2)="Q":PRINT S$(2);S$(1);"/"'), 'Q/');
  check('DIM twice', out(b, 'DIM M(2)'), '?DD ERROR');
  check('wrong dimensions', out(b, 'PRINT M(1)'), '?BS ERROR');
  check('too big', out(b, 'DIM G(10000)'), '?OM ERROR');
  check('new variable while assigning to an array', out(b, 'DIM K(3):K(2)=QQ+5:PRINT K(2)'), ' 5 ');
  check('CLEAR', out(b, 'CLEAR:PRINT AB;Z(10)'), ' 0  0 ');
}

console.log('program');
{
  const b = bootBasic();
  ['10 FOR I=1 TO 3', '20 PRINT I;', '30 NEXT I', '40 GOSUB 100', '50 PRINT "E"', '60 END', '100 PRINT "S";', '110 RETURN']
    .forEach((l) => b.run(l));
  check('RUN', out(b, 'RUN'), ' 1  2  3 SE');
  b.run('25 PRINT "-";');
  check('insert a line', out(b, 'RUN'), ' 1 - 2 - 3 -SE');
  b.run('25');
  check('delete a line', out(b, 'RUN'), ' 1  2  3 SE');
  b.run('20 PRINT I*10;');
  check('replace a line', out(b, 'RUN'), ' 10  20  30 SE');
  check('LIST one line', out(b, 'LIST 20'), '20 PRINT I*10;');
  check('LIST range', out(b, 'LIST 100-'), '100 PRINT "S";\n110 RETURN');
  check('RUN line', out(b, 'RUN 100'), 'S\n?RG ERROR IN 110');
  check('GOTO from direct mode', out(b, 'GOTO 50'), 'E');
  check('undefined line', out(b, 'GOTO 55'), '?UL ERROR');
  b.run('DELETE 40-60');
  check('DELETE range', out(b, 'LIST 30-110'), '30 NEXT I\n100 PRINT "S";\n110 RETURN');
  b.run('I=5');
  b.run('NEW');
  check('NEW', out(b, 'LIST'), '');
  check('NEW clears variables too', out(b, 'PRINT I'), ' 0 ');
}

console.log('control flow');
{
  const b = bootBasic();
  check('IF THEN line', out(b, 'IF 1 THEN 10'), '?UL ERROR');
  check('IF THEN ELSE', out(b, 'IF 0 THEN PRINT "Y" ELSE PRINT "N";:PRINT "!"'), 'N!');
  check('IF true skips ELSE part', out(b, 'IF 1 THEN PRINT "Y"; ELSE PRINT "N"'), 'Y');
  check('IF false without ELSE skips the line', out(b, 'IF 0 THEN PRINT "Y":PRINT "Z"'), '');
  check('IF with string', out(b, 'A$="":IF A$ THEN PRINT 1 ELSE PRINT 2'), ' 2 ');
  // 入れ子の IF: ELSE はいちばん近い、まだ ELSE のない IF に対応する
  for (const [o, i, two, one] of [[0, 0, ' 3 ', ''], [0, 1, ' 3 ', ''], [1, 0, ' 2 ', ' 2 '], [1, 1, ' 1 ', ' 1 ']]) {
    out(b, `A=0:IF ${o} THEN IF ${i} THEN A=1 ELSE A=2 ELSE A=3`);
    check(`nested IF ${o},${i} with outer ELSE`, out(b, 'PRINT A'), o ? two : ' 3 ');
    check(`nested IF ${o},${i} without outer ELSE`, out(b, `IF ${o} THEN IF ${i} THEN PRINT 1 ELSE PRINT 2`), one);
  }
  check('IF in a string does not count', out(b, 'IF 0 THEN PRINT "IF";:IF 1 THEN PRINT 1 ELSE PRINT 2'), '');
  check('ELSE IF chain', out(b, 'IF 0 THEN PRINT 1 ELSE IF 0 THEN PRINT 2 ELSE PRINT 3'), ' 3 ');
  check('FOR STEP', out(b, 'FOR I=10 TO 1 STEP -4:PRINT I;:NEXT:PRINT I'), ' 10  6  2 -2 ');
  check('FOR runs once', out(b, 'FOR I=5 TO 1:PRINT I;:NEXT'), ' 5 ');
  check('nested NEXT J,I', out(b, 'FOR I=1 TO 2:FOR J=1 TO 2:PRINT I;J;:NEXT J,I'), ' 1  1  1  2  2  1  2  2 ');
  check('NEXT without FOR', out(b, 'NEXT'), '?NF ERROR');
  check('RETURN without GOSUB', out(b, 'RETURN'), '?RG ERROR');
  ['10 ON N GOTO 100,200', '20 PRINT "NONE":END', '100 PRINT "A":END', '200 PRINT "B":END'].forEach((l) => b.run(l));
  check('ON GOTO', [out(b, 'N=1:GOTO 10'), out(b, 'N=2:GOTO 10'), out(b, 'N=3:GOTO 10')], ['A', 'B', 'NONE']);
  b.run('NEW');
  ['10 ON 2 GOSUB 100,200:PRINT "R":END', '100 PRINT "1";:RETURN', '200 PRINT "2";:RETURN'].forEach((l) => b.run(l));
  check('ON GOSUB returns after the statement', out(b, 'RUN'), '2R');
  b.run('NEW');
  ['10 N=N+1:GOSUB 10'].forEach((l) => b.run(l));
  check('deep GOSUB runs out of memory', out(b, 'RUN'), '?OM ERROR IN 10');
  b.run('NEW');
  ['10 FOR I=1 TO 3:PRINT I;:STOP:NEXT', '20 PRINT "D"'].forEach((l) => b.run(l));
  check('STOP', out(b, 'RUN'), ' 1 \nBREAK IN 10');
  check('CONT inside FOR', [out(b, 'CONT'), out(b, 'CONT'), out(b, 'CONT')], [' 2 \nBREAK IN 10', ' 3 \nBREAK IN 10', 'D']);
  check('CONT after the end', out(b, 'CONT'), '?CN ERROR');
}

console.log('DATA, INPUT');
{
  const b = bootBasic();
  ['10 READ A,B$,C', '20 PRINT A;B$;C', '30 DATA 1,"X:Y",-3.5', '40 DATA HELLO , 9', '50 READ D$,E:PRINT D$;E',
    '60 RESTORE 40:READ F$:PRINT F$', '70 READ Z,Y'].forEach((l) => b.run(l));
  check('READ, DATA, RESTORE', out(b, 'RUN'), ' 1 X:Y-3.5 \nHELLO  9 \nHELLO \n?OD ERROR IN 70');
  b.run('NEW');
  ['10 READ A,B,C,D$', '20 PRINT A;B;C;D$', '30 DATA &HA2, &h7f ,&HFFFF,"&H1"'].forEach((l) => b.run(l));
  check('hex numbers in DATA (any case, string stays a string)', out(b, 'RUN'), ' 162  127  65535 &H1');
  b.run('NEW');
  b.run('10 READ A:DATA &HZ');
  check('bad hex in DATA is ?SN in the DATA line', out(b, 'RUN'), '?SN ERROR IN 10');
  b.run('10 READ A:DATA &H10000');
  check('too large hex in DATA', out(b, 'RUN'), '?SN ERROR IN 10');
  check('hex limits in expressions', [out(b, 'PRINT &H0000041;&HFFFF'), out(b, 'PRINT &H10000'), out(b, 'PRINT &H')],
    [' 65  65535 ', '?OV ERROR', '?SN ERROR']);
  b.run('NEW');
  b.run('10 INPUT A:PRINT A');
  b.type('RUN\n');
  b.settle();
  b.clearOut();
  b.type('&H10\n');
  b.settle();
  check('hex in INPUT', b.out, '&H10 16 \n>');
  b.run('NEW');
  ['10 INPUT "N";N,S$', '20 PRINT N*2;S$', '30 INPUT X', '40 PRINT X'].forEach((l) => b.run(l));
  check('INPUT prompt', b.run('RUN'), 'RUNN? ');
  check('two values', b.run('5,HI'), '5,HI 10 HI\n? ');
  check('not a number', b.run('A'), 'A?REDO\n? ');
  check('then a number', b.run('7'), '7 7 \n>');
  b.run('RUN');
  check('missing value asks again', b.run('3'), '3?? ');
  check('quoted string with comma', b.run('"P,Q"'), '"P,Q" 6 P,Q\n? ');
  b.run('1');
  check('INPUT in direct mode', out(b, 'INPUT A'), '?ID ERROR');
}

console.log('screen and graphics');
{
  const b = bootBasic();
  // プロンプトが左上を上書きしないように、カーソルを下へ
  b.run('CLS:LOCATE 0,2:PSET 0,0:PSET 95,0:PSET 96,0:PSET -1,5');
  const lcd = b.m.bus.renderLCD();
  check('PSET corners', [lcd[0], lcd[95], lcd[1]], [1, 1, 0]);
  check('POINT', out(b, 'CLS:PSET 0,0:LOCATE 0,2:?POINT(0,0);POINT(1,0);POINT(99,0)'), ' 1  0  0 ');
  b.run('CLS:LINE 0,10,95,10');
  let row = 0;
  for (let x = 0; x < 96; x++) row += b.m.bus.renderLCD()[10 * 96 + x];
  check('LINE (horizontal row y=10 is full)', row, 96);
  b.run('CLS:LINE 0,0,0,31,2:LINE 0,0,0,31,2');
  let col = 0;
  for (let y = 0; y < 32; y++) col += b.m.bus.renderLCD()[y * 96];
  check('LINE mode 2 twice erases', col, 0);
  b.run('CLS:CIRCLE 48,16,10');
  const lc = b.m.bus.renderLCD();
  check('CIRCLE extremes', [lc[16 * 96 + 58], lc[16 * 96 + 38], lc[6 * 96 + 48], lc[26 * 96 + 48], lc[16 * 96 + 48]], [1, 1, 1, 1, 0]);
  check('range', out(b, 'PSET 2000,0'), '?FC ERROR');
  check('LOCATE', out(b, 'CLS:LOCATE 3,1:?"AB";:X=PEEK(238):?X;PEEK(239)'), 'AB 5  1 ');
  check('LOCATE range', out(b, 'LOCATE 16,0'), '?FC ERROR');
}

console.log('sound, timer, keys, memory');
{
  const b = bootBasic();
  b.m.bus.beepEvents.length = 0;
  b.run('BEEP 440,50');
  const ev = b.m.bus.beepEvents;
  const freq = 1e6 * ((ev.length - 1) / 2) / (ev[ev.length - 1].cycle - ev[0].cycle);
  check('BEEP 440Hz, 0.5s: periods', ev.length, 440);
  check('BEEP frequency within 2%', Math.abs(freq - 440) < 9, true);
  check('BEEP range', out(b, 'BEEP 10'), '?FC ERROR');
  const t0 = b.m.cpu.cycles;
  b.run('WAIT 32');
  const dt = b.m.cpu.cycles - t0;
  check('WAIT 32 is about 0.5s', dt > 480000 && dt < 560000, true);
  check('INKEY$ with no key', out(b, 'PRINT LEN(INKEY$)'), ' 0 ');
  check('POKE PEEK', out(b, 'POKE &H700,123:PRINT PEEK(&H700)'), ' 123 ');
  // 0600: LDA #7 / STA $10 / RTS
  b.run('POKE 1536,169:POKE 1537,7:POKE 1538,133');
  b.run('POKE 1539,16:POKE 1540,96');
  check('CALL', out(b, 'CALL &H600:PRINT PEEK(16)'), ' 7 ');
}

console.log('BREAK key');
{
  const b = bootBasic();
  b.run('10 I=I+1:GOTO 10');
  b.type('RUN\n');
  b.cycles(300000);
  b.m.pressBreak();
  b.settle();
  check('stops a program', b.out.slice(-13), 'BREAK IN 10\n>');
  check('CONT continues', out(b, 'PRINT I>10'), '-1 ');
  b.type('CONT\n');
  b.cycles(300000);
  b.m.pressBreak();
  b.settle();
  check('again', b.out.endsWith('BREAK IN 10\n>'), true);
  b.clearOut();
  b.type('PRINT 12');
  b.cycles(50000);
  b.m.pressBreak();
  b.settle();
  check('cancels the line being typed', b.out, 'PRINT 12\n>');
  b.run('NEW');
  b.run('10 INPUT A');
  b.type('RUN\n');
  b.settle();
  b.m.pressBreak();
  b.settle();
  check('stops INPUT', b.out.endsWith('BREAK IN 10\n>'), true);
}

console.log('EDIT');
{
  const b = bootBasic();
  b.run('10 PRINT "OLD"');
  b.clearOut();
  b.type('EDIT 10\n');
  b.settle();
  check('shows the line', b.out, 'EDIT 10>10 PRINT "OLD"');
  b.type('\b\b\b\b\b"NEW"\n');
  b.settle();
  check('edited', out(b, 'LIST'), '10 PRINT "NEW"');
  check('? and \' are shown as PRINT and REM', (b.run('20 ? 1:\' X'), out(b, 'LIST 20')), '20 PRINT 1:REM X');
}

console.log('line editor in BASIC (EDIT, INPUT)');
{
  const L = '\x11', R = '\x12';
  const b = bootBasic();
  b.run('10 PRINT "OLD"');
  b.type('EDIT 10\n');
  b.settle();
  b.type(L.repeat(4) + 'B' + L.repeat(9) + '0\n');   // "OLD" -> "BOLD"、行番号 10 -> 100
  b.settle();
  check('EDIT: insert in the middle and change the line number', out(b, 'LIST'), '10 PRINT "OLD"\n100 PRINT "BOLD"');
  b.type('EDIT 100\n');
  b.settle();
  b.type(L.repeat(6) + '\b'.repeat(6) + 'REM' + R.repeat(2) + '\n');  // "PRINT " を消して REM を入れる
  b.settle();
  check('EDIT: delete in the middle', out(b, 'LIST 100'), '100 REM "BOLD"');

  // プロンプトが長く、行の頭が画面の上に出たとき: ← はいちばん左上で止まり、そこに入る
  b.run('NEW');
  b.run('10 INPUT "LONGPROMPT";A$:PRINT A$');
  const s = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz01234';   // 57文字
  b.type('RUN\n');
  b.settle();
  b.clearOut();
  b.type(s + L.repeat(70) + '\b' + 'Z\n');
  b.settle();
  // "LONGPROMPT? " 12文字 + 57文字 = 5行。見えているのは2行目から(行の5文字目から)。
  // 入力の改行は CHROUT を通らないので、表示の最後の行の後ろ58文字が PRINT A$ の結果
  check('INPUT: ← stops at the top-left and the insert goes there', b.out.split('\n').at(-2).slice(-58), s.slice(0, 4) + 'Z' + s.slice(4));
}

console.log('LIST adds spaces around keywords');
{
  const b = bootBasic();
  const cases = [
    ['10 ?1', '10 PRINT 1'],
    ['20 IFA>0THEN100ELSE200', '20 IF A>0 THEN 100 ELSE 200'],
    ['30 FORI=1TO10STEP2:NEXTI', '30 FOR I=1 TO 10 STEP 2:NEXT I'],
    ['40 IFA$="X"THENPRINTA$', '40 IF A$="X" THEN PRINT A$'],
    ['50 PRINT"A";TAB(3);CHR$(65);SIN(1)', '50 PRINT "A";TAB(3);CHR$(65);SIN(1)'],
    ['60 IF(A>1)THEN10', '60 IF (A>1) THEN 10'],
    ['70 A=-SIN(1)+LEFT$(B$,1)', '70 A=-SIN(1)+LEFT$(B$,1)'],
    ["80 'HELLO", '80 REM HELLO'],
    ['90 ONXGOTO10,20', '90 ON X GOTO 10,20'],
    ['100 PRINTNOTA AND(B OR C)', '100 PRINT NOT A AND (B OR C)'],
    ['110 PRINT 1 :REM X', '110 PRINT 1 :REM X'],
  ];
  for (const [typed, shown] of cases) {
    b.run(typed);
    check(`LIST ${typed}`, out(b, `LIST ${typed.split(' ')[0]}`), shown);
  }
  b.run('NEW');
  b.run('10 IFA>0THENPRINTA');
  b.clearOut();
  b.type('EDIT 10\n');
  b.settle();
  check('EDIT shows the spaced form', b.out, 'EDIT 10>10 IF A>0 THEN PRINT A');
  b.type('\n');
  b.settle();
  const long = '20 IFA>0THENPRINTA:IFB>0THENPRINTB:IFC>0THENPRINTC:GOTO10';
  b.run(long);
  b.clearOut();
  b.type('EDIT 20\n');
  b.settle();
  check('EDIT keeps the typed form when the spaced one is too long', b.out, `EDIT 20>${long}`);
  b.type('\n');
  b.settle();
  check('and the line is kept', out(b, 'LIST 20'), '20 IF A>0 THEN PRINT A:IF B>0 THEN PRINT B:IF C>0 THEN PRINT C:GOTO 10');
  b.run('30 ?1:?2:?3:?4:?5:?6:?7:?8:?9:?1:?2:?3:?4:?5:?6:?7:?8:?9');   // PRINT にすると58文字を超える
  check('a line too long even in the typed form is ?LS as before', out(b, 'EDIT 30'), '?LS ERROR');
}

console.log('RENUM');
{
  // プログラムをメモリから直接読む(LIST は3行でキーを待つので)
  const prog = (b) => {
    const ram = b.ram, res = [];
    let p = 0x800;
    while (ram[p + 1]) {
      let q = p + 4, t = '';
      while (ram[q]) { const c = ram[q++]; t += c >= 0x80 ? `{${c.toString(16)}}` : String.fromCharCode(c); }
      res.push(`${ram[p + 2] | (ram[p + 3] << 8)} ${t}`);
      if ((ram[p] | (ram[p + 1] << 8)) !== q + 1) res.push('BAD LINK');
      p = ram[p] | (ram[p + 1] << 8);
    }
    return res;
  };
  const load = (b) => {
    b.run('NEW');
    ['5 REM GOTO 5', '7 PRINT "GOTO 7":DATA 7,"GOTO 7":RESTORE 7', '9 ON X GOTO 5, 7,9,999',
      '11 IF A THEN 5 ELSE 9', '12 IF A THEN GOSUB 7:GOTO 13', '13 RUN 12'].forEach((l) => b.run(l));
  };
  const b = bootBasic();
  load(b);
  b.run('A=1');
  check('RENUM (warns about a missing line)', out(b, 'RENUM'), 'UNDEF 999 IN 30');
  check('lines and references', prog(b), [
    '10 {8e} GOTO 5',
    '20 {95} "GOTO 7":{83} 7,"GOTO 7":{8b} 20',
    '30 {90} X {88} 10, 20,30,999',
    '40 {8a} A {ac} 10 {a9} 30',
    '50 {8a} A {ac} {8c} 20:{88} 60',
    '60 {89} 50',
  ]);
  check('variables are cleared', out(b, 'PRINT A'), ' 0 ');
  b.run('RENUM 1000,100');
  check('longer numbers', prog(b)[4], '1400 {8a} A {ac} {8c} 1100:{88} 1500');
  b.run('RENUM 1,1');
  check('shorter numbers', prog(b)[2], '3 {90} X {88} 1, 2,3,999');
  load(b);
  b.run('RENUM 100,5,10');
  check('from a line', prog(b).map((l) => l.split(' ')[0]), ['5', '7', '9', '100', '105', '110']);
  check('references to lines before it are kept', prog(b)[2], '9 {90} X {88} 5, 7,9,999');
  check('references to renumbered lines', prog(b)[3], '100 {8a} A {ac} 5 {a9} 9');
  check('RENUM with omitted arguments', (b.run('RENUM ,,100'), prog(b).map((l) => l.split(' ')[0])), ['5', '7', '9', '10', '20', '30']);
  const before = prog(b);
  check('order would change', out(b, 'RENUM 8,1,10'), '?FC ERROR');
  check('over 63999', out(b, 'RENUM 63990,5'), '?FC ERROR');
  check('increment 0', out(b, 'RENUM 10,0'), '?FC ERROR');
  check('syntax', out(b, 'RENUM X'), '?SN ERROR');
  check('nothing changed after errors', prog(b), before);
  check('no lines to renumber', (b.run('RENUM 10,10,50000'), prog(b)), before);
  b.run('NEW');
  check('empty program', out(b, 'RENUM'), '');
  // ない行への参照の知らせ
  b.run('NEW');
  ['5 GOTO 7', '7 GOSUB 3:RESTORE 07', '9 IF A THEN 5 ELSE 99999'].forEach((l) => b.run(l));
  check('warnings: number as written, new line number',
    out(b, 'RENUM 100,10,7'), 'UNDEF 3 IN 100\nUNDEF 99999 IN 110');
  check('renumbered after warnings', prog(b), ['5 {88} 100', '100 {8c} 3:{8b} 100', '110 {8a} A {ac} 5 {a9} 99999']);
  b.run('NEW');
  ['1 GOTO 91', '2 GOTO 92', '3 GOTO 93', '4 GOTO 94', '5 GOTO 95', '6 GOTO 1'].forEach((l) => b.run(l));
  check('waits after 3 rows', out(b, 'RENUM'), 'UNDEF 91 IN 10\nUNDEF 92 IN 20\nUNDEF 93 IN 30');
  b.clearOut();
  b.type('\n');
  b.settle();
  check('RET shows the next rows', b.out, '\nUNDEF 94 IN 40\nUNDEF 95 IN 50\n>');
  check('renumbered', prog(b)[5], '60 {88} 10');
  b.run('NEW');
  ['1 GOTO 91', '2 GOTO 92', '3 GOTO 93', '4 GOTO 94', '5 GOTO 95', '6 GOTO 1'].forEach((l) => b.run(l));
  b.run('RENUM');
  b.clearOut();
  b.type('Q');
  b.settle();
  check('another key hides the rest', b.out, '\n>');
  check('but renumbers', prog(b)[5], '60 {88} 10');
  b.run('NEW');
  ['1 GOTO 91', '2 GOTO 92', '3 GOTO 93', '4 GOTO 94', '6 GOTO 1'].forEach((l) => b.run(l));
  const orig = prog(b);
  b.run('RENUM');
  b.clearOut();
  b.m.pressBreak();
  b.settle();
  check('BREAK cancels RENUM', b.out, '\nBREAK\n>');
  check('nothing changed after BREAK', prog(b), orig);
  b.run('NEW');
  check('LIST shows RENUM', (b.run('10 RENUM'), out(b, 'LIST')), '10 RENUM');
  // 残りが少ないとき: 行番号が伸びて入らなければ何も変えない
  b.run('NEW');
  const ram = b.ram;
  let p = 0x800, n = 1;
  while (p < 0x7E80) {
    const text = [0x88, ...'1'.split('').map((c) => c.charCodeAt(0))];   // GOTO 1
    const next = p + 4 + text.length + 1;
    ram.set([next & 255, next >> 8, n & 255, n >> 8, ...text, 0], p);
    p = next;
    n++;
  }
  ram[p] = 0; ram[p + 1] = 0;
  ram[BSYM.VARTAB] = (p + 2) & 255; ram[BSYM.VARTAB + 1] = (p + 2) >> 8;
  b.run('CLEAR');
  const big = prog(b);
  check('out of memory', out(b, 'RENUM 10000,1'), '?OM ERROR');
  check('nothing changed after OM', prog(b), big);
  // 入るとき: 300行、参照先はばらばら。番号が4桁から5桁に伸びる
  b.run('NEW');
  const N = 300;
  p = 0x800;
  for (let i = 1; i <= N; i++) {
    const text = [0x88, ...[...String(((i * 7) % N) + 1)].map((c) => c.charCodeAt(0)), 0x3a, 0x95, 0x22, 0x41, 0x22];
    const next = p + 4 + text.length + 1;
    ram.set([next & 255, next >> 8, i & 255, i >> 8, ...text, 0], p);   // GOTO n:PRINT "A"
    p = next;
  }
  ram[p] = 0; ram[p + 1] = 0;
  ram[BSYM.VARTAB] = (p + 2) & 255; ram[BSYM.VARTAB + 1] = (p + 2) >> 8;
  b.run('CLEAR');
  check('300 lines', out(b, 'RENUM 10000,1'), '');
  const want = [];
  for (let i = 1; i <= N; i++) want.push(`${9999 + i} {88}${10000 + ((i * 7) % N)}:{95}"A"`);
  check('300 lines renumbered with references', prog(b), want);
}

{
  const b = bootBasic();
  b.run('10 PRINT "ONE"');
  b.run('SAVE "P1"');
  b.run('NEW');
  b.run('10 PRINT "TWO"');
  b.run('SAVE "P2"');
  check('FILES', out(b, 'FILES'), 'B P1       14\nB P2       14');
  b.run('NEW');
  check('LOAD by name', (b.run('LOAD "P2"'), out(b, 'RUN')), 'TWO');
  check('LOAD first', (b.run('LOAD'), out(b, 'RUN')), 'ONE');
  check('not found', out(b, 'LOAD "X"'), '?NT ERROR');
  const t = Array.from(b.m.bus.tape);
  b.m.bus.insertTape(Uint8Array.from(t.map((v, i) => (i === 20 ? v ^ 1 : v))));
  check('broken tape', out(b, 'LOAD "P1"'), '?TP ERROR');
  b.m.bus.insertTape(new Uint8Array(0));
  check('no tape', out(b, 'FILES'), '?NT ERROR');
}

console.log('LOAD with the same name saved more than once');
{
  const b = bootBasic();
  b.run('10 PRINT "OLD"');
  b.run('SAVE "P1"');
  b.run('NEW');
  b.run('10 PRINT "OTHER"');
  b.run('SAVE "P2"');
  b.run('NEW');
  b.run('10 PRINT "NEW"');
  b.run('SAVE "P1"');
  // 最後に、同じ名前のメモリのブロック(モニターの W)を足す。LOAD は読み飛ばす
  const head = [0x50, 0x58, 1, ...[...'P1'.padEnd(8)].map((c) => c.charCodeAt(0)), 0x00, 0x06, 1, 0, 0x99];
  b.m.bus.insertTape(Uint8Array.from([...b.m.bus.tape, ...head, head.reduce((a, v) => a + v, 0) & 255]));
  b.run('NEW');
  check('LOAD by name reads the newest one', (b.run('LOAD "P1"'), out(b, 'RUN')), 'NEW');
  check('LOAD without a name still reads the first one', (b.run('LOAD'), out(b, 'RUN')), 'OLD');
  check('FILES lists every block (waits for a key after 3)', out(b, 'FILES'), 'B P1       14\nB P2       16\nB P1       14');
  b.type('\n');
  b.settle();
  check('the 4th block', b.out.split('\n').at(-2), 'M P1       1');
}

console.log('tape full');
{
  const b = bootBasic();
  b.run('SAVE "BASE"');                       // 空のプログラム: 18バイトのブロック
  const block = b.m.bus.tape;
  const tape = new Uint8Array(3640 * block.length);
  for (let i = 0; i < 3640; i++) tape.set(block, i * block.length);
  b.m.bus.insertTape(tape);                   // 残り16バイト
  b.run('10 PRINT 42');
  check('SAVE on a full tape', out(b, 'SAVE "LAST"'), '?TF ERROR');
  check('the tape is kept as it was', [b.m.bus.tape.length, b.m.bus.tape.every((v, i) => v === tape[i])], [tape.length, true]);
  check('BUSY is off', b.m.bus.lcdAnn & 1, 0);
  b.m.bus.insertTape(new Uint8Array(0));      // このプログラムのブロックの長さを測る
  b.run('SAVE "FIT"');
  const len = b.m.bus.tape.length;
  // 正しいメモリのブロック1つで、残りがちょうど len バイトになるテープ
  const dlen = 65536 - len - 16;
  const filler = new Uint8Array(dlen + 16);
  filler.set([0x50, 0x58, 1, ...Array(8).fill(0x20), 0, 0, dlen & 255, dlen >> 8]);
  filler[filler.length - 1] = filler.reduce((a, v) => (a + v) & 255, 0);
  b.m.bus.insertTape(filler);
  check('SAVE that just fits', out(b, 'SAVE "FIT"'), '');
  check('tape is exactly full', b.m.bus.tape.length, 65536);
  b.run('NEW');
  check('and loads back', (b.run('LOAD "FIT"'), out(b, 'RUN')), ' 42 ');
}

console.log('power with a negative integer exponent');
{
  const b = bootBasic();
  check('2^-127, 2^-128', out(b, 'PRINT 2^-127;2^-128'), ' 5.87747175E-39  2.93873588E-39 ');
  check('10^-39 underflows to 0', out(b, 'PRINT 10^-39'), ' 0 ');
  check('.1^-39 overflows', out(b, 'PRINT .1^-39'), '?OV ERROR');
  check('small cases stay exact', out(b, 'PRINT 2^-3;(-2)^-3;10^-5;10^-9;5^0'), ' .125 -.125  1E-05  1E-09  1 ');
  check('0^-1', out(b, 'PRINT 0^-1'), '?/0 ERROR');
  check('2^-129 underflows to 0', out(b, 'PRINT 2^-129'), ' 0 ');
  check('.5^-127 overflows', out(b, 'PRINT .5^-127'), '?OV ERROR');
}

console.log('EXP near the limits');
{
  const b = bootBasic();
  check('EXP(-88.71), EXP(-88.72) are not 0', out(b, 'PRINT EXP(-88.71);EXP(-88.72)'), ' 2.97670986E-39  2.94709113E-39 ');
  check('below 2^-128 it is 0', out(b, 'PRINT EXP(-88.723);EXP(-89);EXP(-1000)'), ' 0  0  0 ');
  check('largest', out(b, 'PRINT EXP(88.02)'), ' 1.68500154E+38 ');
  check('overflow', out(b, 'PRINT EXP(88.03)'), '?OV ERROR');
  check('overflow far out', out(b, 'PRINT EXP(1000)'), '?OV ERROR');
  check('usual values', out(b, 'PRINT EXP(0);EXP(1);EXP(-1)'), ' 1  2.71828183  .367879441 ');
}

console.log('CIRCLE in XOR mode, POINT inside coordinates');
{
  const b = bootBasic();
  const ram = b.m.bus.ram;
  // 描き終えた直後(プロンプトを出す前)の画面: 描き終えたら $600 に印を書いて止まる
  const draw = (stmts) => {
    b.run('NEW');
    stmts.forEach((st, i) => b.run(`${10 + i} ${st}`));
    b.run('900 POKE 1536,1');
    b.run('910 GOTO 910');
    ram[1536] = 0;
    b.type('RUN\n');
    for (let n = 0; ram[1536] !== 1 && n < 20000; n++) b.cycles(5000);
    const s = Array.from(ram.subarray(0x400, 0x580));
    b.m.pressBreak();
    b.settle();
    return JSON.stringify(s);
  };
  const base = draw(['CLS', 'LINE 0,0,95,31', 'LINE 0,31,95,0']);
  for (const r of [0, 1, 2, 5, 10, 20]) {
    check(`r=${r}: XOR draws the same dots`, draw(['CLS', `CIRCLE 48,16,${r},2`]), draw(['CLS', `CIRCLE 48,16,${r}`]));
    check(`r=${r}: XOR twice restores`, draw(['CLS', 'LINE 0,0,95,31', 'LINE 0,31,95,0', `CIRCLE 48,16,${r},2`, `CIRCLE 48,16,${r},2`]), base);
  }
  b.run('NEW');
  check('PSET 10,POINT(20,30)+30', (b.run('CLS:PSET 10,POINT(20,30)+30'), out(b, '?POINT(10,30);POINT(20,30)')), ' 1  0 ');
  check('LINE with POINT in x2', draw(['CLS', 'PSET 5,5', 'LINE 0,28,POINT(5,5)+10,28']),
    draw(['CLS', 'PSET 5,5', 'LINE 0,28,11,28']));
  check('POINT inside POINT', (b.run('CLS:PSET 3,20'), out(b, '?POINT(POINT(3,20)+2,20+0*POINT(3,20))')), ' 0 ');
}

console.log('RUN annunciator');
{
  const b = bootBasic();
  const run = () => (b.m.bus.lcdAnn & 0x20 ? 'on' : 'off');
  check('off at the prompt', run(), 'off');
  b.run('PRINT 1');
  check('off for a direct statement', run(), 'off');
  b.run('10 FOR I=1 TO 1E9:NEXT');
  b.type('RUN\n');
  b.cycles(200000);
  check('on while running', run(), 'on');
  b.m.pressBreak();
  b.settle();
  check('off after BREAK', run(), 'off');
  b.run('NEW');
  b.run('10 INPUT A');
  b.type('RUN\n');
  b.settle();
  check('on while INPUT waits', run(), 'on');
  b.type('5\n');
  b.settle();
  check('off when the program ends', run(), 'off');
  b.run('NEW');
  b.run('10 X=1/0');
  b.run('RUN');
  check('off after an error', run(), 'off');
  b.run('10 MON');
  b.run('RUN');
  check('off in the monitor', run(), 'off');
  b.run('Q');
  // CALL した機械語から BIOS でモニターに入ったとき(JMP $FF1B、JMP $FF21)
  for (const addr of [0xFF1B, 0xFF21]) {
    b.run('NEW');
    b.run(`POKE 1536,76:POKE 1537,${addr & 255}:POKE 1538,${addr >> 8}`);
    b.run('10 CALL 1536');
    b.run('RUN');
    check(`off after entering the monitor by JMP $${addr.toString(16).toUpperCase()}`, run(), 'off');
    b.run('Q');
  }
}

console.log('monitor and reset');
{
  const b = bootBasic();
  b.run('10 PRINT "KEEP"');
  check('MON', b.run('MON'), 'MON*');
  check('Q returns to BASIC with the program', (b.run('Q'), out(b, 'RUN')), 'KEEP');
  // Q では変数が残る(画面も消さない)
  b.run('A=5:B$="HELLO":DIM C(3):C(2)=7:D$=B$+"!"');
  b.run('MON');
  check('Q prints only the prompt', b.run('Q'), 'Q>');
  check('variables are kept after Q', out(b, 'PRINT A;B$;C(2);D$'), ' 5 HELLO 7 HELLO!');
  b.run('FOR I=1 TO 50:X$=STR$(I)+"ABC":NEXT:Y$=X$');
  b.run('MON');
  b.run('Q');
  check('strings after many temporaries', out(b, 'PRINT Y$;I'), ' 50ABC 51 ');
  b.run('MON');
  b.run(`E ${BSYM.ARYTAB.toString(16)} FF 7F`);   // 記録を壊す(arytab > strend)
  b.run('Q');
  check('broken pointers: variables are cleared', out(b, 'PRINT A;B$'), ' 0 ');
  check('broken pointers: program is kept', out(b, 'LIST'), '10 PRINT "KEEP"');
  b.run('20 A=42:MON');
  b.run('RUN');
  b.run('Q');
  check('MON inside a program: variables kept', out(b, 'PRINT A'), ' 42 ');
  check('but CONT is not possible', out(b, 'CONT'), '?CN ERROR');
  b.run('20');
  b.run('Z=9');
  b.m.reset();
  b.settle();
  check('reset keeps the program', out(b, 'RUN'), 'KEEP');
  check('reset clears variables', out(b, 'PRINT Z'), ' 0 ');
  b.m.powerOn();
  b.settle();
  check('power on clears it', out(b, 'LIST'), '');
}

console.log('CALC (calculator mode)');
{
  const b = bootBasic();
  // 1行を打って、エコーとプロンプト(C> か >)を除いた表示を返す
  const calc = (line) => {
    let r = b.run(line);
    if (r.startsWith(line)) r = r.slice(line.length);
    return r.replace(/\n?C?>$/, '');
  };
  b.run('10 PRINT "PROG"');
  check('CALC changes the prompt to C>', b.run('CALC'), 'CALCC>');
  check('an expression shows its value', calc('1+2'), ' 3 ');
  check('a line starting with a number is an expression', calc('100 / 7'), ' 14.2857143 ');
  check('functions', calc('SQR(2)'), ' 1.41421356 ');
  check('starting with - . ( or "', [calc('-5*3'), calc('.5*4'), calc('(2+3)*4'), calc('"AB"+"C"')],
    ['-15 ', ' 2 ', ' 20 ', 'ABC']);
  check('variable=... assigns (nothing shown)', calc('R=5'), '');
  check('and the variable can be used', calc('PI*R^2'), ' 78.5398163 ');
  check('a comparison in parentheses', [calc('(R=5)'), calc('R<=4')], ['-1 ', ' 0 ']);
  check('arrays and strings', [calc('A(3)=7'), calc('A(3)*2'), calc('A$="X"'), calc('A$+A$')], ['', ' 14 ', '', 'XX']);
  check('a statement runs as usual', [calc('DEG'), calc('SIN(30)'), calc('?1;2')], ['', ' .5 ', ' 1  2 ']);
  check('an error stays in CALC', b.run('1+'), '1+?SN ERROR\nC>');
  check('an empty line just shows C> again', b.run(''), 'C>');
  check('no program lines in CALC', [calc('10'), calc('LIST')], [' 10 ', '10 PRINT "PROG"']);
  check('RUN comes back to C>', b.run('RUN'), 'RUNPROG\nC>');
  b.m.pressBreak();
  b.settle();
  check('BREAK at C> goes back to >', b.out.endsWith('C>\n>'), true);
  check('then lines are program lines again', (b.run('20 PRINT 2'), out(b, 'LIST')), '10 PRINT "PROG"\n20 PRINT 2');
  check('CALC in a program is kept as CALC', (b.run('30 CALC'), out(b, 'LIST 30')), '30 CALC');
  check('and turns on CALC when the program ends', b.run('RUN'), 'RUNPROG\n 2 \nC>');
  b.m.pressBreak();
  b.settle();
  // 添字の中の文字列にある ( ) は数えない(代入として実行し、値が入ったことまで確かめる)
  b.run('CALC');
  check('subscript with "(" in a string is an assignment', [calc('A(LEN("("))=7'), calc('A(1)')], ['', ' 7 ']);
  check('subscript with ")" in a string', [calc('A(LEN(")"))=8'), calc('A(1)')], ['', ' 8 ']);
  check('ASC("(") in a subscript', [calc('A(ASC("(")-39)=9'), calc('A(1)')], ['', ' 9 ']);
  check('spaces and nesting in a subscript', [calc('A ( ( 1+1 ) * ( LEN("()") ) ) = 4'), calc('A(4)')], ['', ' 4 ']);
  check('string array, 2 dimensions, string functions',
    [calc('B$(LEN(")("),ASC(MID$("A(B",2,1))-39)="Z"'), calc('B$(2,1)')], ['', 'Z']);
  check('a string that never closes is not an assignment', calc('A(LEN("()=1'), '?SN ERROR');
  // CALC の中の EDIT: 直した行はプログラムに入り、C> に戻る
  b.m.pressBreak();                 // 計算モードではプログラムの行を打てないので、いったん抜ける
  b.settle();
  b.run('NEW');
  b.run('10 PRINT 1');
  b.run('CALC');
  b.type('EDIT 10\n');
  b.settle();
  b.clearOut();
  b.type('\b2\n');
  b.settle();
  check('EDIT in CALC stores the edited line and comes back to C>', [b.out.endsWith('2C>'), calc('LIST')], [true, '10 PRINT 2']);
  b.type('EDIT 10\n');
  b.settle();
  b.clearOut();
  b.type('\x11'.repeat(7) + '\b\b\b\n');   // 行番号を消すと、いつもの直接実行
  b.settle();
  check('EDIT without the line number runs it as a direct command', [b.out.endsWith('\b 2 \nC>'), calc('LIST')], [true, '10 PRINT 2']);
  b.type('EDIT 10\n');
  b.settle();
  b.clearOut();
  b.m.pressBreak();
  b.settle();
  check('BREAK while editing cancels the edit but stays in CALC', [b.out, calc('LIST')], ['\nC>', '10 PRINT 2']);
  b.run('MON');
  check('back from the monitor with Q: not in CALC', b.run('Q'), 'Q>');
  b.run('CALC');
  b.m.reset();
  b.settle();
  check('reset ends CALC', b.out.endsWith('>') && !b.out.endsWith('C>'), true);
}

console.log('replacing or deleting a line with more than 256 bytes after it (found by the coverage tool)');
{
  // 前は、消した行の後ろが256バイトを超えると vartab が256の倍数だけ手前になり、
  // 次に行を入れたり変数を作ったりすると、プログラムの終わりが壊れた
  const b = bootBasic();
  const lines = [];
  for (let i = 1; i <= 20; i++) lines.push(`${i * 10} PRINT "LINE${i}";"ABCDEFGHIJKLMNOPQRSTUVWXYZ";${i}*2:REM X`);
  for (const l of lines) b.run(l);
  const vartab = () => b.ram[BSYM.VARTAB] | (b.ram[BSYM.VARTAB + 1] << 8);
  const before = vartab();
  const len10 = (b.ram[0x800] | (b.ram[0x801] << 8)) - 0x800;   // 10行目の長さ(つなぎから)
  b.run('10');
  check('deleting the first line moves vartab back by its length', before - vartab(), len10);
  b.run('A=1:B$="HELLO":DIM Z(30)');
  check('variables do not overwrite the last line', out(b, 'LIST 200'), lines[19]);
  b.run(lines[0]);
  b.run(lines[0]);                  // 同じ行を置き換える(消してから入れる)
  const listed = lines.map((l, i) => out(b, `LIST ${(i + 1) * 10}`));
  check('all lines are intact after re-inserting and replacing', listed, lines);
  check('the program still runs', out(b, 'RUN').split('\n').slice(-1), ['LINE20ABCDEFGHIJKLMNOPQRSTUVWXYZ 40 ']);
}

console.log('exponents with three or more digits (found by the coverage tool)');
{
  // 前は、指数が3桁を超えると符号が逆になった(1E200 が 0、1E-200 が ?OV)
  const b = bootBasic();
  check('1E200 overflows', out(b, 'PRINT 1E200'), '?OV ERROR');
  check('1E999 overflows', out(b, 'PRINT 1E999'), '?OV ERROR');
  check('1E-200 and 1E-999 are 0', out(b, 'PRINT 1E-200;1E-999;0E999'), ' 0  0  0 ');
  check('VAL("1E200")', out(b, 'PRINT VAL("1E200")'), '?OV ERROR');
  check('VAL("1E-200")', out(b, 'PRINT VAL("1E-200")'), ' 0 ');
  check('exponent and many digits together', out(b, 'PRINT .000000000000000000000000000000000000001E40'), ' 10 ');
  check('many digits before a negative exponent', out(b, 'PRINT 123456789012345678901234567890E-25'), ' 12345.6789 ');
  b.run('A$="1":FOR I=1 TO 150:A$=A$+"0":NEXT');
  check('VAL of 1 and 150 zeros overflows', out(b, 'PRINT VAL(A$)'), '?OV ERROR');
  b.run('A$="1":FOR I=1 TO 115:A$=A$+"0":NEXT');
  check('VAL of 1, 115 zeros and E-100', out(b, 'PRINT VAL(A$+"E-100")'), ' 1E+15 ');
  b.run('A$=".":FOR I=1 TO 115:A$=A$+"0":NEXT');
  check('VAL of ., 115 zeros and 1E110', out(b, 'PRINT VAL(A$+"1E110")'), ' 1E-06 ');
  // R13-01: 前は、指数部を足す前に 120 で止めたので、桁と指数部が打ち消し合うと桁違いになった
  b.run('A$="1":FOR I=1 TO 83:A$=A$+"0":NEXT');
  check('84 digits and E-121 (R13-01)', out(b, 'PRINT VAL(A$+"E-121");VAL(A$+"E-83");VAL(A$+"E-45")'), ' 1E-38  1  1E+38 ');
  b.run('A$="0.":FOR I=1 TO 100:A$=A$+"0":NEXT:A$=A$+"1"');
  check('0. 100 zeros 1 and E129 (R13-01)', out(b, 'PRINT VAL(A$+"E129");VAL(A$+"E101")'), ' 1E+28  1 ');
  b.run('A$="1":FOR I=1 TO 119:A$=A$+"0":NEXT');
  check('120 digits and E-129 (R13-01)', out(b, 'PRINT VAL(A$+"E-129");VAL(A$+"E-119")'), ' 1E-10  1 ');
  b.run('A$="1":FOR I=1 TO 245:A$=A$+"0":NEXT');
  check('246 digits cancelled by the exponent', out(b, 'PRINT VAL(A$+"E-245");VAL(A$+"E-283");VAL(A$+"E-207")'), ' 1  1E-38  1E+38 ');
  check('246 digits: just too small', out(b, 'PRINT VAL(A$+"E-284")'), ' 0 ');
  b.run('A$=".":FOR I=1 TO 245:A$=A$+"0":NEXT');
  check('245 zeros after the point cancelled by the exponent', out(b, 'PRINT VAL(A$+"1E246");VAL(A$+"1E284");VAL(A$+"1E208")'), ' 1  1E+38  1E-38 ');
  check('245 zeros after the point: just too large', out(b, 'PRINT VAL(A$+"1E285")'), '?OV ERROR');
  b.run('A$="1":FOR I=1 TO 245:A$=A$+"0":NEXT');
  check('exponent digits carrying into the high byte', out(b, 'PRINT VAL(A$+"E-259");VAL(A$+"E-1234")'), ' 1E-14  0 ');
  check('3- and 4-digit exponents', [out(b, 'PRINT 1E300'), out(b, 'PRINT 1E1234'), out(b, 'PRINT 1E-300;1E-260;1E-1234')],
    ['?OV ERROR', '?OV ERROR', ' 0  0  0 ']);
  check('digits after the point beyond 10 are dropped', out(b, 'PRINT 1.23456789012345;-.000123456789012345'), ' 1.23456789 -1.23456789E-04 ');
  check('E+ and a small e in VAL', out(b, 'PRINT VAL("1e5");VAL("2E+3");2E+3;VAL("1e-2")'), ' 100000  2000  2000  .01 ');
  check('a second decimal point ends the number', out(b, 'PRINT VAL("1.2.3")'), ' 1.2 ');
  check('very long exponents', [out(b, 'PRINT 1E99999999999999'), out(b, 'PRINT 1E-99999999999999;-1E-9999')], ['?OV ERROR', ' 0  0 ']);
}

console.log('paths the tests had never run (found by the coverage tool)');
{
  const b = bootBasic();
  check('PRINT , goes to the next 8 columns', out(b, 'PRINT 1,2'), ' 1       2 ');
  check('PRINT , after column 8 goes to the next line', out(b, 'PRINT "ABCDEFGHI",3'), 'ABCDEFGHI\n 3 ');
  check('TAB and SPC', [out(b, 'PRINT TAB(5);"X"'), out(b, 'PRINT "AB";TAB(1);"X"'), out(b, 'PRINT SPC(3);"X"'), out(b, 'PRINT SPC(0);"X"')],
    ['     X', 'ABX', '   X', 'X']);
  check('IF ... GOTO', [b.run('10 IF 1 GOTO 30'), b.run('20 PRINT "NO"'), b.run('30 PRINT "YES"'), out(b, 'RUN')].pop(), 'YES');
  b.run('NEW');
  b.lines('10 GOSUB 100:PRINT "BACK":END', '100 FOR I=1 TO 3', '110 RETURN');
  check('RETURN from inside a FOR in the subroutine', out(b, 'RUN'), 'BACK');
  b.run('NEW');
  b.lines('10 FOR I=1 TO 2:FOR J=1 TO 2:FOR I=5 TO 6:PRINT I;J;:NEXT', '20 PRINT "E"');
  check('FOR with the same variable drops the inner loops', out(b, 'RUN'), ' 5  1  6  1 E');
  check('DIM of several arrays', out(b, 'DIM P(3),Q$(4),R(2,2):Q$(4)="Z":R(2,2)=5:?Q$(4);R(2,2)'), 'Z 5 ');
  check('line numbers: carry into the high byte', out(b, 'GOTO 256'), '?UL ERROR');
  check('line number 64000 is too large', [out(b, 'GOTO 64000'), out(b, '64000 PRINT')], ['?SN ERROR', '?SN ERROR']);
  check('0^2, 0^0, 2^1.5', out(b, 'PRINT 0^2;0^0;2^1.5'), ' 0  1  2.82842712 ');
  check('more digits than fit', out(b, 'PRINT 12345678901234;.0000000000001234'), ' 1.23456789E+13  1.234E-13 ');
  check('EDIT and DELETE errors', [out(b, 'EDIT'), out(b, 'EDIT 5'), out(b, 'DELETE')], ['?SN ERROR', '?UL ERROR', '?FC ERROR']);
  check('CIRCLE with a negative radius', out(b, 'CIRCLE 10,10,-1'), '?FC ERROR');
  check('BEEP out of range', [out(b, 'BEEP 19'), out(b, 'BEEP 20001'), out(b, 'BEEP 440,-1')], ['?FC ERROR', '?FC ERROR', '?FC ERROR']);
  check('PRESET', out(b, 'PSET 5,5:PRESET 5,5:PRINT POINT(5,5)'), ' 0 ');
  // 答えを表示すると左上の点が消えるので、先に変数に入れる
  check('LINE through negative coordinates', [b.run('CLS:LINE 5,5,-3,5:LINE 2,9,2,-5:P=POINT(0,5):Q=POINT(2,0)'), out(b, '?P;Q')][1], ' 1  1 ');
  b.run('NEW');
  b.run('10 INPUT "NAME",A$:PRINT "[";A$;"]"');
  b.clearOut(); b.type('RUN\n'); b.settle(); b.type('BOB\n'); b.settle();
  check('INPUT "prompt", has no ?', b.out, 'RUNNAMEBOB[BOB]\n>');
}

console.log('INPUT ?REDO with a string variable (B22-01, found by the input fuzzing)');
{
  // 引用符の後に文字があると ?REDO。そのたびに一時文字列がたまり、8回目で ?OM になっていた
  const b = bootBasic();
  b.run('10 INPUT S$,T$:PRINT "[";S$;"][";T$;"]"');
  let all = b.run('RUN');
  for (let k = 0; k < 12; k++) all += b.run(k % 2 ? 'A,"B"X' : '"A"X');
  all += b.run('OK,"Z"');
  check('12 times ?REDO and then the answer', all.endsWith('? OK,"Z"[OK][Z]\n>'), true);
  check('no ?OM', all.includes('?OM'), false);
  check('temporary strings are all freed', b.ram[BSYM.TEMPPT], 0);
}

console.log('garbage collection keeps string variables (found by the coverage tool)');
{
  const b = bootBasic();
  b.lines('10 A$=LEFT$("KEEPME",4):B$="LIT":D$=STR$(12345)', '15 DIM X$(3):X$(1)=MID$("ARRAYZ",1,5)',
    '20 FOR I=1 TO 3000:C$=STR$(I)+"ABCDEFGHIJ":NEXT', '30 PRINT A$;B$;D$;X$(1);C$');
  check('strings survive many collections', out(b, 'RUN', 20000), 'KEEPLIT 12345ARRAY 3000ABCDEFGHIJ');
  check('the collector ran with a string variable', (b.m.watchCoverage[BSYM.GSC_2 + 4] & 1) === 1, true);
}

console.log('LIST waits when the screen is full');
{
  const b = bootBasic();
  for (let i = 1; i <= 9; i++) b.run(`${i * 10} PRINT ${i}`);
  b.clearOut(); b.type('LIST\n'); b.settle();
  check('stops after 3 lines', b.out, 'LIST10 PRINT 1\n20 PRINT 2\n30 PRINT 3');
  b.type('\x14'); b.settle();
  check('↓ shows 3 more', b.out.endsWith('60 PRINT 6'), true);
  b.type(' '); b.settle();
  check('space shows the rest', b.out.endsWith('90 PRINT 9\n>'), true);
  b.clearOut(); b.type('LIST\n'); b.settle(); b.type('X'); b.settle();
  check('another key ends the listing', b.out, 'LIST10 PRINT 1\n20 PRINT 2\n30 PRINT 3\n>');
}

console.log('LOAD of a program that does not fit');
{
  const b = bootBasic();
  b.run('10 B=2');
  const len = 0x7800;
  const head = [0x50, 0x58, 0x02, ...'BIG     '.split('').map((c) => c.charCodeAt(0)), 0x00, 0x08, len & 255, len >> 8];
  const all = [...head, ...new Array(len).fill(0x20)];
  b.m.bus.insertTape([...all, all.reduce((a, x) => (a + x) & 255, 0)]);
  check('?OM and the program in memory is kept', [out(b, 'LOAD "BIG"', 3000), out(b, 'LIST')], ['?OM ERROR', '10 B=2']);
}

console.log('$07FF is used by BASIC (docs/basic.md, Memory map)');
{
  const b = bootBasic();
  b.lines('10 PRINT "A"', 'SAVE "P"');
  b.run('POKE 2047,58');
  check('RUN with $07FF not 0 is ?SN', out(b, 'RUN'), '?SN ERROR IN 0');
  b.run('NEW');
  check('NEW sets it back to 0', out(b, 'PRINT PEEK(2047)'), ' 0 ');
  b.run('POKE 2047,58');
  b.run('LOAD "P"');
  check('LOAD sets it back to 0', [out(b, 'PRINT PEEK(2047)'), out(b, 'RUN')], [' 0 ', 'A']);
  // 見張り(test/watch.js)も $07FF が0でないことを報告する。ここではわざとなので取り除く
  check('the watch reports it', [...new Set(takeViolations().map((t) => t.replace(/^.*?: .*?: /, '')))], ['$07FF is not 0']);
}

console.log('RND(0) returns the last value made (docs/basic.md)');
{
  const b = bootBasic();
  check('0 before any value is made', out(b, 'PRINT RND(0)'), ' 0 ');
  b.run('X=RND(1)');
  const x = out(b, 'PRINT X');
  check('the last value', out(b, 'PRINT RND(0)'), x);
  check('RANDOMIZE, CLEAR and RUN keep it', [out(b, 'RANDOMIZE:PRINT RND(0)'), out(b, 'CLEAR:PRINT RND(0)')], [x, x]);
  b.m.reset();
  b.settle();
  check('reset keeps it', out(b, 'PRINT RND(0)'), x);
  b.run('Y=RND(-1)');
  check('RND(-1) makes a value too', out(b, 'PRINT RND(0)=Y'), '-1 ');
}

console.log('VAL does not write outside BASIC memory (found by the fuzzer)');
{
  // 前は、VAL が文字列の直後を一時的に0にするとき、空の文字列なら $0000 に、
  // 文字列領域のいちばん上の文字列なら I/O の $8000 に書いていた。
  // 今は文字列を $7FFE より下に置き、$7FFF を VAL のために空けている
  const b = bootBasic();
  takeViolations();
  check('VAL of an empty array element', out(b, 'DIM Q$(3):PRINT VAL(Q$(2));VAL("")'), ' 0  0 ');
  b.run('POKE 32767,5:A$=STR$(12345)');
  check('the first string ends at $7FFE', (b.ram[BSYM.FRETOP] | (b.ram[BSYM.FRETOP + 1] << 8)) + 6, 0x7fff);
  check('VAL of the string at the top', out(b, 'PRINT VAL(A$);VAL(A$+"9")'), ' 12345  123459 ');
  check('$7FFF is put back', out(b, 'PRINT PEEK(32767)'), ' 5 ');
  check('no writes outside BASIC memory', takeViolations(), []);
}

console.log('VAL puts back the byte after the string even after an error (R16-01)');
{
  // 前は、VAL が ?OV などで抜けると、文字列の直後を0にしたまま残し、プログラムや隣の文字列を壊した
  const b = bootBasic();
  const prog = () => Array.from(b.ram.subarray(0x7ff, b.ram[BSYM.VARTAB] | (b.ram[BSYM.VARTAB + 1] << 8)));
  const valPtrHi = () => b.ram[BSYM.VAL_PTR + 1];
  b.run('10 A$="1E999":PRINT VAL(A$)');
  b.run('20 PRINT VAL("1E-5");VAL("")');
  const before = prog();
  check('RUN stops with ?OV', out(b, 'RUN'), '?OV ERROR IN 10');
  check('every byte of the program is kept', prog(), before);
  check('LIST shows the whole line', out(b, 'LIST 10'), '10 A$="1E999":PRINT VAL(A$)');
  check('nothing left to put back', valPtrHi(), 0);
  b.run('NEW');
  b.run('A$="HELLO"+"!":B$="1E999"+" "');
  const fretop = () => b.ram[BSYM.FRETOP] | (b.ram[BSYM.FRETOP + 1] << 8);
  const strings = () => Array.from(b.ram.subarray(fretop(), 0x7fff));
  const s1 = strings();
  check('VAL of the string just below another overflows', out(b, 'PRINT VAL(B$)'), '?OV ERROR');
  check('the strings are kept byte for byte', [strings(), out(b, 'PRINT A$')], [s1, 'HELLO!']);
  b.run('POKE 32767,77:C$="1E99"+"9"');
  check('the string at the top overflows', out(b, 'PRINT VAL(C$)'), '?OV ERROR');
  check('$7FFF is put back after the error', out(b, 'PRINT PEEK(32767)'), ' 77 ');
  // 正常、空の文字列、エラーをくり返しても、前の記録で書き戻さない
  b.run('D$="5"');
  check('normal, empty, error, normal', [out(b, 'PRINT VAL(D$);VAL("")'), out(b, 'PRINT VAL(C$)'), out(b, 'PRINT VAL(D$)'), valPtrHi()],
    [' 5  0 ', '?OV ERROR', ' 5 ', 0]);
  b.run('POKE 32767,0:E$="ZZ"');
  check('an unrelated error does not write old addresses', [out(b, 'PRINT 1/0'), out(b, 'PRINT PEEK(32767);E$')], ['?/0 ERROR', ' 0 ZZ']);
  // VAL の途中でリセットされた: 記録を置いて、0にしたバイトがリセットで戻ることを確かめる
  b.run('NEW');
  b.run('10 A$="12345"');
  const quote = 0x800 + b.ram.subarray(0x800, 0x820).lastIndexOf(0x22);   // 閉じる "
  b.ram[BSYM.STR_SAVE] = 0x22;
  b.ram[quote] = 0;
  b.ram[BSYM.VAL_PTR] = quote & 0xff;
  b.ram[BSYM.VAL_PTR + 1] = quote >> 8;
  b.m.reset();
  b.settle();
  check('reset in the middle of VAL puts the byte back', [out(b, 'LIST 10'), valPtrHi()], ['10 A$="12345"', 0]);
  // 電源を入れたときは、残っている記録で書かない(RAM の中身は意味がない)
  b.ram[BSYM.VAL_PTR + 1] = 0x7f;
  b.ram[BSYM.VAL_PTR] = 0xff;
  b.ram[0x7fff] = 0x99;
  b.ram[BSYM.BMAGIC] = 0;              // 印が壊れている: コールドスタート
  b.m.reset();
  b.settle();
  check('a cold start does not write with an old record', [b.ram[0x7fff], valPtrHi()], [0x99, 0]);
}

console.log('LIST puts no space between a keyword and ) (found by the fuzzer)');
{
  // 前は PI) が PI ) と表示され、LIST の表示を打ち直すとプログラムのバイトが変わった
  const b = bootBasic();
  const line = '10 IF TAN(PI) THEN A=(PI):B$=(INKEY$)+(STR$(PI))';
  b.run(line);
  const bytes = Array.from(b.ram.subarray(0x800, 0x840));
  const listed = out(b, 'LIST 10');
  check('LIST shows the line as typed', listed, line);
  b.run('NEW');
  b.run(listed);
  check('retyping what LIST shows gives the same bytes', Array.from(b.ram.subarray(0x800, 0x840)), bytes);
  check('spaces after keywords are still added before letters', [b.run('20 A=PI AND 1'), out(b, 'LIST 20')][1], '20 A=PI AND 1');
}

console.log('work areas ($0200-$03FF) do not overlap');
{
  // rom/*.s の「名前 = $番地 ; 大きさ …」を集めて、重なりがないか調べる(大きさを書いていなければ1バイト)
  const dir = new URL('../rom/', import.meta.url);
  const parse = (text, defs) => {
    for (const line of text.split('\n')) {
      const m = line.match(/^(\w+)\s*=\s*\$([0-9A-F]{4})\b\s*(?:;\s*(\d+)(?![\d$]))?/i);
      if (!m) continue;
      const addr = parseInt(m[2], 16);
      if (addr < 0x200 || addr > 0x3ff) continue;
      const name = m[1].toLowerCase();
      if (!defs.has(name)) defs.set(name, { name, addr, size: Math.max(1, Number(m[3] ?? 1)) });
    }
    return defs;
  };
  const sources = readdirSync(dir).filter((n) => /^(basic.*|monitor)\.s$|^px65\.inc$/.test(n))
    .map((f) => readFileSync(new URL(f, dir), 'utf8'));
  // わざと重ねているもの(同時に使わない)だけを許す:
  //   RENUM の作業領域(rn_*)と、グラフィック・BEEP・テープの名前(basic.s のコメントのとおり)
  //   SIN などの符号(trig_s)と ATN の符号(atn_s)
  const RENUM_SHARES = new Set(['gx0', 'gy0', 'gx1', 'gy1', 'gdx', 'gdy', 'gsx', 'gsy', 'gerr',
    'bp_half', 'bp_cnt', 'bp_lvl', 'tname']);
  const shared = (a, b) => {
    const [x, y] = [a.name, b.name].sort();
    if (x === 'atn_s' && y === 'trig_s') return true;
    if (a.name.startsWith('rn_') && RENUM_SHARES.has(b.name)) return true;
    if (b.name.startsWith('rn_') && RENUM_SHARES.has(a.name)) return true;
    return false;
  };
  const clashesOf = (defs) => {
    const list = [...defs.values()];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.addr < b.addr + b.size && b.addr < a.addr + a.size && !shared(a, b)) out.push([a.name, b.name].sort().join(' '));
      }
    }
    return out;
  };
  const real = new Map();
  for (const t of sources) parse(t, real);
  check(`no overlaps among ${real.size} names`, clashesOf(real), []);
  // 調べ方そのものの確かめ: わざと重ねた定義を見逃さない
  const withFake = (text) => { const d = parse(text, new Map()); for (const t of sources) parse(t, d); return clashesOf(d); };
  check('detects calcmode put on gc_end', withFake('calcmode = $03F3 ; 1').includes('calcmode gc_end'), true);
  check('detects rn_new moved onto gc_end', withFake('rn_new = $03F3 ; 2').includes('gc_end rn_new'), true);
  check('detects rn_new moved onto calcmode', withFake('rn_new = $02F8 ; 2').includes('calcmode rn_new'), true);
  check('detects a 2-byte area running into the next', withFake('gx0 = $02DA ; 2').includes('gx0 pow_n'), true);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
