// src/ と web/ui.js と内蔵ROMを、ダブルクリックで開ける1つのHTMLにまとめる
//
//   node tools/build.js [--rom rom/test_pattern.bin]
//
// 日本語版 dist/px65.html と英語版 dist/px65-en.html を作る。文言は web/i18n.js にある。
// 公開ページ(GitHub Pages)の入口 dist/index.html も、web/home.html から作る(日英を選ぶだけのページ)。
//
// ブラウザは file:// で開いたページから別のJavaScriptファイル(ESモジュール)を読み込めないため、
// import / export を取り除いて1つの <script> に入れる。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS } from '../web/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 依存される順に並べる
const MODULES = ['src/cpu65c02.js', 'src/bus.js', 'src/machine.js', 'src/disasm.js', 'web/i18n.js', 'web/keyqueue.js', 'web/ui.js'];

// 言語 -> 出力ファイル
const LANGS = { ja: 'dist/px65.html', en: 'dist/px65-en.html' };

// 各モジュールを関数で囲み、export した名前だけを返す。import は受け取った値の分割代入に置き換える。
// これでモジュールの中だけで使う名前(hex2 など)が衝突しない
function wrapModule(path) {
  let code = readFileSync(join(root, path), 'utf8');
  const exported = [];

  code = code.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';\s*$/gm, (_, names, from) => {
    const target = join(dirname(path), from).replace(/\\/g, '/');
    if (!MODULES.includes(target)) throw new Error(`${path}: ${from} は MODULES にありません`);
    return `const {${names}} = __modules['${target}'];`;
  });
  code = code.replace(/^export\s+(?:async\s+)?(const|let|class|function)\s+([A-Za-z_$][\w$]*)/gm, (m, kind, name) => {
    exported.push(name);
    return m.replace(/^export\s+/, '');
  });
  code = code.replace(/^export\s+const\s+/gm, 'const '); // 念のため
  if (/^\s*(import|export)\b/m.test(code)) throw new Error(`${path}: 変換できない import / export があります`);

  // "export const A = 1, B = 2;" のような1行に複数の定義はないものとする
  return `// ===== ${path} =====\n__modules['${path}'] = (() => {\n${code}\nreturn { ${exported.join(', ')} };\n})();\n`;
}

function bundle(romBytes, lang) {
  const rom = Buffer.from(romBytes).toString('base64');
  const parts = MODULES.map(wrapModule);
  const script = `(() => {\n'use strict';\nconst BUILTIN_ROM_BASE64 = '${rom}';\nconst UI_LANG = '${lang}';\nconst __modules = {};\n\n${parts.join('\n')}\n})();`;
  if (/<\/script/i.test(script)) throw new Error('スクリプトに </script が含まれています');
  return script;
}

// どの言語も日本語と同じキーをそろえているか確かめる
function checkStrings() {
  const base = Object.keys(STRINGS.ja).sort().join(',');
  for (const lang of Object.keys(LANGS)) {
    if (!STRINGS[lang]) throw new Error(`web/i18n.js に ${lang} がありません`);
    const keys = Object.keys(STRINGS[lang]).sort().join(',');
    if (keys !== base) {
      const missing = Object.keys(STRINGS.ja).filter((k) => !(k in STRINGS[lang]));
      const extra = Object.keys(STRINGS[lang]).filter((k) => !(k in STRINGS.ja));
      throw new Error(`web/i18n.js の ${lang} のキーが ja と違います。足りない: ${missing.join(', ')} 余分: ${extra.join(', ')}`);
    }
  }
}

// エミュレーターのバージョンは package.json の version だけで決める
const VERSION = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

function render(template, lang, romBytes) {
  const text = { ...STRINGS[lang], version: VERSION };
  let html = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in text)) throw new Error(`web/index.html の {{${key}}} が web/i18n.js にありません`);
    return text[key];
  });
  html = html.replace('/*__SCRIPT__*/', () => bundle(romBytes, lang));
  return html;
}

// 入口のページ。{{version}} だけを埋める
function renderHome() {
  const template = readFileSync(join(root, 'web/home.html'), 'utf8');
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key !== 'version') throw new Error(`web/home.html の {{${key}}} は使えません`);
    return VERSION;
  });
}

// 出力ファイル名 → HTML(ファイルには書かない。test/dist.test.js が dist/ と比べる)
export function buildAll(romPath) {
  checkStrings();
  const template = readFileSync(join(root, 'web/index.html'), 'utf8');
  if (!template.includes('/*__SCRIPT__*/')) throw new Error('web/index.html に /*__SCRIPT__*/ がありません');
  const romBytes = readFileSync(join(root, romPath));
  const out = {};
  for (const [lang, file] of Object.entries(LANGS)) out[file] = { lang, html: render(template, lang, romBytes) };
  out['dist/index.html'] = { lang: 'ja/en', html: renderHome() };
  return out;
}

function main(argv) {
  let romPath = 'rom/test_pattern.bin';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rom') romPath = argv[++i];
  }
  for (const [file, { lang, html }] of Object.entries(buildAll(romPath))) {
    const outPath = join(root, file);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html);
    console.log(`${file}: ${(html.length / 1024).toFixed(1)} KB (${lang})`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
