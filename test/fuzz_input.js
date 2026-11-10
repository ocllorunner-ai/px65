// ファジング: INPUT(test/fuzz.js の input)
//
// INPUT を1〜3個並べたプログラムを作り、でたらめな答えの行を打つ。答えは、数(10進、小数、指数、&H)、
// 数でないもの、"..." の文字列、引用符のない文字列、足りない・多すぎる項目、空の行、空白だけの行、: を含む行など。
// JavaScript の写し(simulate)で、INPUT がその行をどう読むかを計算し、次を比べる。
//   - 画面に出る文字の全部(見出し、? 、?? 、?REDO、打った行のエコー、最後に PRINT した値)
//   - 何行読んだら終わるか(写しの予想どおりの行数で、プログラムが終わって > に戻ること)
//   - 指数があふれる数では ?OV ERROR で止まること
// ときどき BREAK を押して、BREAK IN で止まることも調べる。
//
// 写しの決まり(docs/basic.md の INPUT の説明と、rom/basic_stmt.s の st_input / read_item、rom/basic_fp.s の fin):
//   - 見出しがなければ "? "、"見出し"; なら 見出しと "? "、"見出し", なら見出しだけ
//   - 最初の項目で行が空なら "?? " で聞き直す(空白だけの行は空ではない)
//   - 次の変数の前で行が終わっていれば(: も行の終わりとみなす)"?? " で続きを聞く
//   - 数: 先頭の空白は飛ばし、数の中の空白も飛ばす(1 2 は 12)。符号、小数点、E の指数。&H は16進数(4桁を超える値は ?REDO)
//     数の後が , か行の終わり(: を含む)でなければ ?REDO で、その INPUT の最初の変数からやり直す
//   - 文字列: "..." なら引用符の中(閉じなくてもよい。後ろが , か行の終わりでなければ ?REDO)。
//     引用符がなければ、先頭の空白を飛ばして , か : か行の終わりまで(後ろの空白は残る)
//   - 多すぎる項目は読み捨てる

const MAXLINE = 58;

// 数を BASIC の PRINT と同じ形にする(有効数字9桁。前に符号の場所、後ろに空白)
export function fmtNum(v) {
  if (v === 0) return ' 0 ';
  const [mant, ex] = Math.abs(v).toExponential(8).split('e');
  const d = mant.replace('.', '').replace(/0+$/, '') || '0';
  const E = Number(ex) + 1;
  let body;
  if (E >= 1 && E <= 9) body = d.length <= E ? d + '0'.repeat(E - d.length) : d.slice(0, E) + '.' + d.slice(E);
  else if (E === 0) body = '.' + d;
  else if (E === -1) body = '.0' + d;
  else body = d[0] + (d.length > 1 ? '.' + d.slice(1) : '') + 'E' + (E - 1 < 0 ? '-' : '+') + String(Math.abs(E - 1)).padStart(2, '0');
  return (v < 0 ? '-' : ' ') + body + ' ';
}

// 入力の行を読む位置(rom/basic_main.s の chrget / chrgot と同じ: 空白を飛ばす。: は行の終わりと同じ)
class Cursor {
  constructor(line) { this.s = line; this.i = -1; }
  got() { while (this.s[this.i] === ' ') this.i++; return this.i < this.s.length && this.i >= 0 ? this.s[this.i] : ''; }
  get() { this.i++; return this.got(); }
  atEnd() { const c = this.got(); return c === '' || c === ':'; }
}

class Redo extends Error {}
class Overflow extends Error {}

// 数を1つ読む(read_item の数の部分)。値を返す。数でなければ Redo、あふれれば Overflow
function readNumber(cur) {
  let c = cur.get();
  if (c === '&') {
    if (cur.get().toUpperCase() !== 'H') throw new Redo();
    let v = 0, n = 0;
    for (;;) {
      const h = cur.get().toUpperCase();
      if (!/^[0-9A-F]$/.test(h)) break;
      if (v & 0xf000) throw new Redo();   // 4桁を超える値(rom/basic_expr.s の hex_lit は ?OV を返し、INPUT は ?REDO にする)
      v = (v << 4) | parseInt(h, 16); n++;
    }
    if (!n) throw new Redo();
    return v;
  }
  // fin
  let neg = false;
  if (c === '-') { neg = true; c = cur.get(); } else if (c === '+') c = cur.get();
  let digits = '', dexp = 0, pt = false, nd = 0;
  for (;;) {
    if (/^[0-9]$/.test(c)) {
      if (digits === '' && c === '0') { if (pt) dexp--; }
      else if (nd < 10) { digits += c; nd++; if (pt) dexp--; }
      else if (!pt) dexp++;
      c = cur.get();
    } else if (c === '.' && !pt) { pt = true; c = cur.get(); }
    else if (c === 'E' || c === 'e') {
      c = cur.get();
      let eneg = false, ev = 0;
      if (c === '-') { eneg = true; c = cur.get(); } else if (c === '+') c = cur.get();
      while (/^[0-9]$/.test(c)) { ev = ev >= 100 ? 1000 : ev * 10 + Number(c); c = cur.get(); }
      dexp += eneg ? -ev : ev;
      break;
    } else break;
  }
  if (!digits) return 0;
  const v = Number(digits + 'e' + dexp);
  if (v >= 1.7e38) throw new Overflow();
  if (v < 3e-39) return 0;
  return neg ? -v : v;
}

// 文字列を1つ読む(read_item の文字列の部分)
function readString(cur) {
  let c = cur.get();
  const s = cur.s;
  if (c === '"') {
    let j = cur.i + 1, out = '';
    while (j < s.length && s[j] !== '"') out += s[j++];
    cur.i = j < s.length ? j + 1 : j;
    return out;
  }
  let j = cur.i, out = '';
  if (j < 0) j = 0;
  while (j < s.length && s[j] !== ',' && s[j] !== ':') out += s[j++];
  cur.i = j;
  return out;
}

// INPUT 文1つを写す。takeLine() で答えの行をもらう。
// 返す値: { text: 画面に出る文字, values: { 変数: 値 }, error: 'OV' | null }
export function simulate(stmt, takeLine, values) {
  let text = (stmt.prompt ?? '') + (stmt.sep === ',' ? '' : '? ');
  for (;;) {   // ?REDO でここに戻る
    let line = takeLine();
    if (line === null) return { text, error: 'BREAK' };
    text += line;
    let cur = new Cursor(line);
    let first = true;
    let redo = false;
    for (const v of stmt.vars) {
      const more = first ? line === '' : cur.atEnd();
      first = false;
      if (more) {
        do {
          text += '?? ';
          line = takeLine();
          if (line === null) return { text, error: 'BREAK' };
          text += line;
        } while (line === '');
        cur = new Cursor(line);
      }
      try {
        const val = v.type === 'num' ? readNumber(cur) : readString(cur);
        const c = cur.got();
        if (!(c === '' || c === ':' || c === ',')) throw new Redo();
        values[v.name] = val;
      } catch (e) {
        if (e instanceof Redo) { redo = true; break; }
        if (e instanceof Overflow) return { text, error: 'OV' };
        throw e;
      }
    }
    if (!redo) return { text, error: null };
    text += '?REDO\n? ';
  }
}

// ---- 答えを作る ----
function numItem(r) {
  const sp = () => (r.chance(0.15) ? ' ' : '');
  const sign = r.pick(['', '', '', '-', '+']);
  switch (r.int(0, 9)) {
    case 0: case 1: return sp() + sign + r.int(0, 9999999);
    case 2: { const a = String(r.int(0, 999)), f = String(r.int(0, 9999)).padStart(r.int(1, 4), '0'); return sign + (r.chance(0.2) ? '' : a) + '.' + f; }
    case 3: return sign + r.int(1, 999) + r.pick(['E', 'e']) + r.pick(['', '-', '+']) + r.int(0, 30);
    case 4: return '&' + r.pick(['H', 'h']) + sp() + r.int(0, 0xffff).toString(16).toUpperCase().padStart(r.int(1, 5), '0');
    case 5: { const s = String(r.int(10, 9999)); const p = r.int(1, s.length - 1); return s.slice(0, p) + ' ' + s.slice(p); }   // 数の中の空白
    case 6: return r.pick(['AB', '1X', '&HZ', '&', '&H', '.', '-', '..5', '1.2.3', '"5"', '1E', '1E+', 'E5', '&H12345', '12-3', '3 :', '9E99']);
    case 7: return r.pick(['0', '-0', '000123', '.000', '00.5']);
    default: return String(r.int(0, 99));
  }
}
function strItem(r) {
  const chars = [...'ABCxyz 019!?#'];
  const word = () => Array.from({ length: r.int(0, 8) }, () => r.pick(chars)).join('');
  switch (r.int(0, 5)) {
    case 0: return '"' + word() + r.pick(['', ',', ':', ' , ']) + word() + '"';
    case 1: return '"' + word();   // 閉じない
    case 2: return '"' + word() + '"' + r.pick(['X', ' ', ' Y']);   // 引用符の後に何かある
    default: return r.pick(['', ' ', '  ']) + word();
  }
}
// pending: これから読む変数の型の並び。
// 1行は58文字まで(それより後ろは打っても入らない)なので、どの形でも58文字に切る(T22-01)
export function makeAnswer(r, pending) {
  return answerText(r, pending).slice(0, MAXLINE);
}
function answerText(r, pending) {
  switch (r.int(0, 11)) {
    case 0: return '';
    case 1: return '   ';
    case 2: return pending.map((t) => (t === 'num' ? numItem(r) : strItem(r))).join(',') + ':' + strItem(r);
    default: {
      const n = Math.max(0, pending.length + r.pick([0, 0, 0, -1, 1, 2]));
      const items = Array.from({ length: n }, (_, k) => ((pending[k] ?? r.pick(['num', 'str'])) === 'num' ? numItem(r) : strItem(r)));
      return items.join(r.pick([',', ', ', ' ,', ' , ']));
    }
  }
}

// ---- 1件 ----
// env: { b(), typed, fail(reason, extra) }
export function caseInput(r, env) {
  const b = env.b();
  const typed = env.typed;
  const NUM = ['A', 'B', 'C', 'X(1)', 'X(3)'], STR = ['S$', 'T$', 'Y$(2)'];
  const stmts = [];
  for (let k = r.int(1, 3); k > 0; k--) {
    const vars = Array.from({ length: r.int(1, 3) }, () => (r.chance(0.55) ? { name: r.pick(NUM), type: 'num' } : { name: r.pick(STR), type: 'str' }));
    const p = r.int(0, 2);
    stmts.push({ vars, prompt: p ? r.pick(['N', 'AGE', 'X=', '>>']) : null, sep: p === 1 ? ';' : p === 2 ? ',' : null });
  }
  const lines = ['5 DIM X(5),Y$(5)'];
  stmts.forEach((s, k) => lines.push(`${10 + k * 10} INPUT ${s.prompt === null ? '' : `"${s.prompt}"${s.sep}`}${s.vars.map((v) => v.name).join(',')}`));
  const used = [...new Set(stmts.flatMap((s) => s.vars.map((v) => v.name)))];
  used.forEach((name, k) => lines.push(`${100 + k * 10} PRINT "[";${name};"]"`));
  typed.push('NEW');
  b.run('NEW');
  for (const l of lines) { typed.push(l); b.run(l); }

  // 写しで、打つ行と画面に出る文字を決める
  const values = {};
  const answers = [];
  let expect = 'RUN';
  let error = null, errLine = null;
  let breakAt = r.chance(0.08) ? r.int(0, 3) : -1;
  for (let k = 0; k < stmts.length && !error; k++) {
    const s = stmts[k];
    let pendingFrom = 0;
    const take = () => {
      if (answers.length === breakAt) return null;
      if (answers.length > 40) throw new Error('too many lines');
      // 型は、まだ読んでいない変数の並び(写しの中の位置までは分からないので、全部を渡す)
      const a = makeAnswer(r, s.vars.slice(pendingFrom).map((v) => v.type));
      answers.push(a);
      return a;
    };
    const res = simulate(s, take, values);
    expect += res.text;
    if (res.error) { error = res.error; errLine = 10 + k * 10; }
  }
  // 打つ
  let out = '';
  typed.push('RUN');
  out += b.run('RUN');
  for (const a of answers) {
    typed.push(JSON.stringify(a));
    const o = b.run(a);
    out += o;
    if (o.endsWith('(timeout)')) return env.fail('did not come back', JSON.stringify(out.slice(-120)));
  }
  if (error === 'BREAK') {
    typed.push('(BREAK)');
    b.clearOut();
    b.m.pressBreak();
    if (!b.settle(600)) return env.fail('BREAK did not stop INPUT');
    out += b.out;
    if (!out.startsWith(expect)) return env.fail('unexpected output before BREAK', `got  ${JSON.stringify(out)}\nwant ${JSON.stringify(expect)}...`);
    if (!new RegExp(`BREAK IN ${errLine}\\n>$`).test(out)) return env.fail('BREAK did not stop with BREAK IN', JSON.stringify(out.slice(-60)));
    return;
  }
  if (error === 'OV') {
    if (!out.startsWith(expect)) return env.fail('unexpected output before ?OV', `got  ${JSON.stringify(out)}\nwant ${JSON.stringify(expect)}...`);
    if (!new RegExp(`\\?OV ERROR IN ${errLine}\\n>$`).test(out)) return env.fail('expected ?OV ERROR', JSON.stringify(out.slice(-60)));
    return;
  }
  for (const name of used) {
    const v = values[name];
    expect += '[' + (v === undefined ? (name.includes('$') ? '' : ' 0 ') : typeof v === 'number' ? fmtNum(v) : v) + ']\n';
  }
  expect += '>';
  if (out !== expect) env.fail('unexpected output', `got  ${JSON.stringify(out)}\nwant ${JSON.stringify(expect)}`);
}
