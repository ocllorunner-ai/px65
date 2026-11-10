// Klaus Dormann のテスト(as65 アセンブラ用のソース)を tools/asm.js の書式に直す
//
// as65 のうち、テストで使っている範囲だけに対応する:
//   if / else / endif、macro / endm(\1 などの引数、名前付きの引数、\? のローカルラベル)、
//   = と equ、org、ds、db、dw、data / bss / code(いつも org が続くので無視)、noopt、end
// settings に書いた定数は、ソースの値を上書きする。macros に書いたマクロは、ソースの定義より優先する

export function convertAs65(src, { settings = {}, macros: override = {} } = {}) {
  const out = [];
  const vars = {};                 // if で使う定数の値
  const macros = {};               // 名前 -> { params, body }
  let uniq = 0;

  const value = (expr) => {
    // 数と名前を1回で読み分ける($10 を 0x10 にしてから名前を探すと、x10 を名前と間違える)
    const js = expr.trim().replace(/\$([0-9a-fA-F]+)|%([01]+)|'(.)'|(\d+)|([A-Za-z_]\w*)/g, (_, hex, bin, ch, dec, name) => {
      if (hex !== undefined) return String(parseInt(hex, 16));
      if (bin !== undefined) return String(parseInt(bin, 2));
      if (ch !== undefined) return String(ch.charCodeAt(0));
      if (dec !== undefined) return dec;
      if (!(name in vars)) throw new Error(`unknown: ${name}`);
      return String(vars[name]);
    });
    return Number(Function(`return (${js})`)());
  };
  const cond = (expr) => {
    const js = expr.replace(/!=/g, '\u0001').replace(/<=/g, '\u0002').replace(/>=/g, '\u0003')
      .replace(/=/g, '==').replace(/\u0001/g, '!=').replace(/\u0002/g, '<=').replace(/\u0003/g, '>=');
    return Boolean(value(js));
  };
  const isMacro = (name) => name in override || name in macros;

  function run(lines) {
    const stack = [];              // { on: いまの区間が有効か, done: どこかの区間が有効だったか }
    let def = null;                // 定義中のマクロ
    const active = () => stack.every((s) => s.on);
    for (const raw of lines) {
      const line = raw.replace(/;.*$/, '').replace(/\s+$/, '');
      if (!line.trim()) continue;
      const words = line.trim().split(/\s+/);
      const w0 = words[0].toLowerCase();
      if (def) {                   // マクロの中身はそのまま覚える(if も展開するときに評価する)
        if (w0 === 'endm') { if (!(def.name in override)) macros[def.name] = def; def = null; }
        else def.body.push(raw.replace(/;.*$/, ''));
        continue;
      }
      if (w0 === 'if') {
        const on = active() && cond(line.trim().slice(2));
        stack.push({ on, done: on, parent: active() });
        continue;
      }
      if (w0 === 'else') {
        const top = stack[stack.length - 1];
        top.on = top.parent && !top.done;
        top.done = top.done || top.on;
        continue;
      }
      if (w0 === 'endif') { stack.pop(); continue; }
      if (!active()) continue;
      if (words[1]?.toLowerCase() === 'macro') {
        def = { name: words[0], params: words.slice(2).join(' ').split(',').map((p) => p.trim()).filter(Boolean), body: [] };
        continue;
      }
      if (['bss', 'data', 'code', 'noopt', 'end'].includes(w0)) continue;
      if (w0 === 'include') throw new Error(`include is not supported: ${line}`);
      // 定数
      const m = line.match(/^([A-Za-z_]\w*)\s*(?:=|\s+equ\s+)\s*(.+)$/i);
      if (m) {
        const name = m[1];
        let v;
        if (name in settings) v = settings[name];
        else { try { v = value(m[2]); } catch { v = null; } }
        if (v !== null) { vars[name] = v; out.push(`${name} = ${v}`); }
        else out.push(`${name} = ${m[2].trim()}`);
        continue;
      }
      // ラベルと命令に分ける(行頭から始まる語はラベル)
      let label = '', rest = line;
      const lm = line.match(/^([A-Za-z_]\w*):?(.*)$/);
      if (lm) { label = lm[1]; rest = lm[2]; }
      if (label) out.push(`${label}:`);
      rest = rest.trim();
      if (!rest) continue;
      const [op, ...argv] = rest.split(/\s+/);
      const args = argv.join(' ');
      if (isMacro(op)) {           // マクロを展開する
        const params = args ? args.split(',').map((a) => a.trim()) : [];
        const id = `_m${uniq++}`;
        const body = override[op] ? override[op](params) : macros[op].body.map((l) => {
          let s = l.replace(/\\\?/g, id).replace(/\\(\d)/g, (_, n) => params[n - 1] ?? '');
          macros[op].params.forEach((p, i) => { s = s.replace(new RegExp(`\\b${p}\\b`, 'g'), params[i] ?? ''); });
          return s;
        });
        run(body);
        continue;
      }
      const lop = op.toLowerCase();
      if (lop === 'org') out.push(`        .org ${args}`);
      else if (lop === 'ds') out.push(`        .fill ${args}`);
      else if (lop === 'db') out.push(`        .byte ${args}`);
      else if (lop === 'dw') out.push(`        .word ${args}`);
      else out.push(`        ${rest}`);
    }
    if (def) throw new Error(`macro ${def.name} has no endm`);
  }

  run(src.split(/\r?\n/));
  return out.join('\n');
}
