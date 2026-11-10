// PX-65 エミュレーター: ブラウザのUI
//
// tools/build.js がこのファイルと src/ のモジュールを1つのHTMLにまとめる。
// まとめるときに import 文は取り除かれ、内蔵ROMが BUILTIN_ROM_BASE64 として埋め込まれる。

import { Machine, FPS, toBase64, fromBase64 } from '../src/machine.js';
import { LCD_WIDTH, LCD_HEIGHT, CPU_HZ, ROM_SIZE, TAPE_MAX } from '../src/bus.js';
import { F_N, F_V, F_B, F_D, F_I, F_Z, F_C } from '../src/cpu65c02.js';
import { disassemble } from '../src/disasm.js';
import { STRINGS } from './i18n.js';
import { KeyQueue, KEY_POSITION } from './keyqueue.js';

/* global BUILTIN_ROM_BASE64, UI_LANG */

// UIの言語はビルド時に決まる(UI_LANG)。文言は web/i18n.js にある
const TEXT = STRINGS[UI_LANG] ?? STRINGS.ja;
function t(key, vars = {}) {
  const s = TEXT[key];
  if (s === undefined) throw new Error(`missing text: ${key}`);
  return s.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));
}
const num = (n) => n.toLocaleString(TEXT.locale);

const $ = (id) => document.getElementById(id);
const hex2 = (v) => v.toString(16).toUpperCase().padStart(2, '0');
const hex4 = (v) => v.toString(16).toUpperCase().padStart(4, '0');

// ---------------- 保存領域(使えない環境でも動くように) ----------------

const store = {
  get(key) { try { return localStorage.getItem('px65.' + key); } catch { return null; } },
  set(key, value) {
    try { localStorage.setItem('px65.' + key, value); return true; } catch { return false; }
  },
  remove(key) { try { localStorage.removeItem('px65.' + key); } catch { /* 何もしない */ } },
};

// ---------------- 本体 ----------------

const machine = new Machine();
const { bus, cpu } = machine;

let powered = true;
let running = true;       // false なら一時停止(デバッガ)
let speed = 1;
let soundOn = true;
let vibrateOn = store.get('vibrate') !== '0'; // 初めて開いたときはオン
// 画面の SHIFT キー: オンなら1回押すと次の1文字だけ効く(ワンショット)。オフなら押している間だけ効く。
// 初めて開いたときはオン(マウスでは2つのキーを同時に押せないため)
let oneShotShift = store.get('oneShotShift') !== '0';
let shiftLatched = false;     // ワンショットの SHIFT が効いている(次のキーを待っている)
// 電源を切ってもRAMを残す: 初めて開いたときはオン(オフにした人は '0' が記録されている)
let keepRam = store.get('keepRam') !== '0';
let romName = t('builtinRom');

function setStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function loadRomBytes(bytes, name) {
  if (bytes.length > ROM_SIZE) {
    setStatus(t('romTooLarge', { size: num(bytes.length) }), true);
    return false;
  }
  machine.loadROM(bytes);
  romName = name;
  return true;
}

function startUp() {
  const saved = store.get('rom');
  const savedName = store.get('romName');
  if (saved) {
    try {
      loadRomBytes(fromBase64(saved), savedName || t('loadedRom'));
    } catch {
      loadRomBytes(fromBase64(BUILTIN_ROM_BASE64), romName);
    }
  } else {
    loadRomBytes(fromBase64(BUILTIN_ROM_BASE64), romName);
  }

  const savedRam = keepRam ? store.get('ram') : null;
  if (savedRam) {
    try { bus.ram.set(fromBase64(savedRam)); } catch { /* 壊れていたら空のRAMで始める */ }
    machine.powerOn({ keepRAM: true });
    setStatus(t('startedRestored', { rom: romName }));
  } else {
    machine.powerOn();
    setStatus(t('started', { rom: romName }));
  }
}

// ---------------- 仮想テープ ----------------

let tapeName = store.get('tapeName') || t('tapeDefaultName');

function updateTapeInfo() {
  const size = bus.tape.length;
  $('tapeInfo').textContent = size ? t('tapeInfo', { name: tapeName, size: num(size) }) : t('tapeNone');
  $('tapeSave').disabled = size === 0;
  $('tapeEject').disabled = size === 0;
}

// テープの中身をブラウザに覚えておく(次に開いたときも同じテープが入っている)
function rememberTape() {
  if (bus.tape.length === 0) {
    store.remove('tape');
    store.remove('tapeName');
    return true;
  }
  return store.set('tape', toBase64(bus.tape)) && store.set('tapeName', tapeName);
}

function restoreTape() {
  const saved = store.get('tape');
  if (!saved) return;
  try { bus.insertTape(fromBase64(saved)); } catch { store.remove('tape'); }
}

// ROMが録音を止めたとき
bus.onTapeRecorded = (bytes) => {
  const ok = rememberTape();
  updateTapeInfo();
  setStatus(t('tapeRecorded', { size: num(bytes.length) }) + (ok ? '' : t('tapeNotRemembered')));
};

$('tapeInsert').addEventListener('click', () => $('tapeFile').click());
$('tapeFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > TAPE_MAX) {
    setStatus(t('tapeTooLarge', { size: num(bytes.length) }), true);
    return;
  }
  bus.insertTape(bytes);
  tapeName = file.name;
  const ok = rememberTape();
  updateTapeInfo();
  setStatus(t('tapeInserted', { name: file.name, size: num(bytes.length) }) + (ok ? '' : t('tapeNotRemembered')));
});

// ファイル名を選べるブラウザでは保存ダイアログを出し、それ以外はダウンロードする
$('tapeSave').addEventListener('click', async () => {
  const bytes = bus.tape;
  if (bytes.length === 0) { setStatus(t('tapeEmpty'), true); return; }
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: tapeName,
        types: [{ description: 'PX-65 tape', accept: { 'application/octet-stream': ['.tap'] } }],
      });
      const w = await handle.createWritable();
      await w.write(bytes);
      await w.close();
      tapeName = handle.name;
      rememberTape();
      updateTapeInfo();
      setStatus(t('tapeSaved', { name: handle.name }));
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // キャンセルした
      // ダイアログが使えない環境(file:// など)では下のダウンロードにする
    }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = tapeName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(t('tapeSaved', { name: tapeName }));
});

$('tapeEject').addEventListener('click', () => {
  bus.insertTape(new Uint8Array(0));
  tapeName = t('tapeDefaultName');
  rememberTape();
  updateTapeInfo();
  setStatus(t('tapeEjected'));
});

function saveRamIfNeeded() {
  if (keepRam) store.set('ram', toBase64(bus.ram));
}

// ---------------- キーボード ----------------

const KEY_FACE = { LEFT: '←', RIGHT: '→', UP: '↑', DOWN: '↓', SPACE: '', '*': '×', '/': '÷', '-': '−' };
const KEY_LABEL = { LEFT: t('keyLeft'), RIGHT: t('keyRight'), UP: t('keyUp'), DOWN: t('keyDown'),
  SPACE: t('keySpace'), BRK: 'BREAK', RET: 'RET', DEL: 'DEL', SHIFT: 'SHIFT', '*': t('keyTimes'),
  '/': t('keyDivide'), '-': t('keyMinus'), '+': t('keyPlus'), '=': t('keyEquals'), ',': t('keyComma'),
  '.': t('keyPeriod') };

// SHIFTと押すと出る文字(ROMのキー表と同じ)。キーの右上に小さく表示する
const SHIFT_LEGEND = { '1': '!', '2': '"', '3': '#', '4': '$', '5': '%', '6': '&', '7': "'", '8': '(',
  '9': ')', '0': '@', ',': '<', '.': '>', '/': '?', '-': '_', '*': ':', '+': ';', '=': '^' };

const keyButtons = new Map(); // キー名 -> ボタン
const holders = new Map();    // キー名 -> 押している入力元の数(画面のキーとPCのキーボード)
const pointers = new Map();   // pointerId -> キー名(画面のキーを押している指やマウス。1本ずつ離すため)

// ---- マトリクスへの反映(web/keyqueue.js) ----
const keyQueue = new KeyQueue(bus, KEY_POSITION);
const queueKey = (down, name, shift) => keyQueue.push(down, name, shift, powered && running);
const processKeys = () => keyQueue.process(powered && running); // 止まっているときは待たない

// shift: PCで記号を打ったときに必要な SHIFT の状態(画面のキーでは null)
function pressKey(name, shift = null) {
  ensureAudio();
  const n = (holders.get(name) || 0) + 1;
  holders.set(name, n);
  keyButtons.get(name)?.classList.add('down');
  if (n > 1) return;
  if (name === 'BRK') {
    if (powered) machine.pressBreak();
    return;
  }
  queueKey(true, name, shift);
}

function releaseKey(name, shift = null) {
  const n = (holders.get(name) || 0) - 1;
  if (n > 0) { holders.set(name, n); return; }
  holders.delete(name);
  keyButtons.get(name)?.classList.remove('down');
  if (name === 'BRK') return;
  queueKey(false, name, shift);
  // ワンショットの SHIFT は、次のキーを離したら一緒に離す
  if (shiftLatched && name !== 'SHIFT') unlatchShift();
}

// 画面の SHIFT キーを押したとき(ワンショット): 1回目で効かせ、もう一度押したら取り消す
function toggleShiftLatch() {
  if (shiftLatched) { unlatchShift(); return; }
  shiftLatched = true;
  pressKey('SHIFT');
}

function unlatchShift() {
  if (!shiftLatched) return;
  shiftLatched = false;
  releaseKey('SHIFT');
}

function releaseAllKeys() {
  shiftLatched = false;
  keyQueue.releaseAll();
  for (const name of holders.keys()) keyButtons.get(name)?.classList.remove('down');
  holders.clear();
  pcKeys.clear();
  pointers.clear();
}

function makeKey(name, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'key ' + cls;
  b.textContent = KEY_FACE[name] ?? name;
  if (SHIFT_LEGEND[name]) {
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = SHIFT_LEGEND[name];
    sub.setAttribute('aria-hidden', 'true');
    b.append(sub);
  }
  b.setAttribute('aria-label', KEY_LABEL[name] ?? name);
  b.tabIndex = -1; // フォーカス移動の邪魔にならないように。PCのキーボードで入力できる
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') buzz();
    if (name === 'SHIFT' && oneShotShift) { toggleShiftLatch(); return; } // 離したときは何もしない
    if (pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, name);
    pressKey(name);
  });
  // pointerup の後に lostpointercapture も来るので、同じ指で2回離さないようにする
  const up = (e) => {
    if (pointers.get(e.pointerId) !== name) return;
    pointers.delete(e.pointerId);
    releaseKey(name);
  };
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('lostpointercapture', up);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  keyButtons.set(name, b);
  return b;
}

// 振動に対応した端末(主にAndroid)で、キーを押した手応えを返す
function buzz() {
  if (!vibrateOn) return;
  try { navigator.vibrate?.(8); } catch { /* 対応していない */ }
}

// 振動の設定は、振動できるタッチ端末(主にAndroid)だけに表示する。
// iPhoneのSafariは navigator.vibrate を持たないので、押しても何も起きない設定は出さない
const canVibrate = typeof navigator.vibrate === 'function'
  && window.matchMedia('(pointer: coarse)').matches;

// 文字キーと数字キーの切り替え(スマートフォンだけで表示される)
function makeModeKey() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'key mode mobile-only';
  b.tabIndex = -1;
  const keys = $('keys');
  const update = () => {
    const alpha = keys.dataset.tab === 'alpha';
    b.textContent = alpha ? '123' : 'ABC';
    b.setAttribute('aria-label', alpha ? t('toNumberKeys') : t('toLetterKeys'));
  };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (e.pointerType === 'touch') buzz();
    keys.dataset.tab = keys.dataset.tab === 'alpha' ? 'num' : 'alpha';
    update();
  });
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  update();
  return b;
}

function buildKeyboard() {
  const fkeys = $('fkeys');
  fkeys.append(makeKey('BRK', 'brk'), makeKey('DEL', 'fn'));
  const arrows = document.createElement('div');
  arrows.className = 'arrows';
  arrows.append(makeKey('UP', 'fn'), makeKey('DOWN', 'fn'), makeKey('LEFT', 'fn'), makeKey('RIGHT', 'fn'));
  fkeys.append(arrows);

  const alpha = $('alpha');
  const rows = [
    [...'QWERTYUIOP'],
    [...'ASDFGHJKL'],
    [...'ZXCVBNM,'],
  ];
  for (const keys of rows) {
    const row = document.createElement('div');
    row.className = 'row';
    for (const k of keys) row.append(makeKey(k));
    alpha.append(row);
  }
  $('bottom').append(makeModeKey(), makeKey('SHIFT', 'fn wide'), makeKey('SPACE', 'space'),
    makeKey('RET', 'fn wide'));

  const pad = $('pad');
  for (const k of ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '=', '+']) {
    pad.append(makeKey(k, /[0-9.]/.test(k) ? 'num' : 'op'));
  }
}

// PCのキーボード。まず物理キー(code)で探し、なければ入力された文字(key)で探す
const CODE_MAP = {
  Space: 'SPACE', Enter: 'RET', NumpadEnter: 'RET', ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT',
  Backspace: 'DEL', Delete: 'DEL', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN',
  Escape: 'BRK', NumpadAdd: '+', NumpadSubtract: '-', NumpadMultiply: '*', NumpadDivide: '/',
  NumpadDecimal: '.', NumpadEqual: '=',
};
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') CODE_MAP['Key' + c] = c;
for (let d = 0; d <= 9; d++) { CODE_MAP['Digit' + d] = String(d); CODE_MAP['Numpad' + d] = String(d); }
// 記号 -> [本体のキー, SHIFTを押すか]。PCのキーボードの配列によらず、打った記号がそのまま入る
const CHAR_MAP = {};
for (const k of ['+', '-', '*', '/', '=', ',', '.']) CHAR_MAP[k] = [k, false];
for (const [k, c] of Object.entries(SHIFT_LEGEND)) CHAR_MAP[c] = [k, true];

const pcKeys = new Map(); // code -> { name, shift }(離したときに同じキーを離すため)

function isTyping(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement
    || target instanceof HTMLTextAreaElement;
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
  // 記号は文字で決める(キーボードの配列によって位置が違うため)。それ以外は物理キーで決める
  const sym = CHAR_MAP[e.key];
  const name = sym ? sym[0] : CODE_MAP[e.code];
  if (!name) return;
  e.preventDefault();
  if (e.repeat || pcKeys.has(e.code)) return;
  const shift = sym ? sym[1] : null;
  pcKeys.set(e.code, { name, shift });
  pressKey(name, shift);
});

document.addEventListener('keyup', (e) => {
  const k = pcKeys.get(e.code);
  if (!k) return;
  pcKeys.delete(e.code);
  releaseKey(k.name, k.shift);
});

window.addEventListener('blur', releaseAllKeys);

// ---------------- 液晶 ----------------

const DOT = 5; // 1ドットの大きさ(すき間1pxを含む)
const lcdCtx = $('lcd').getContext('2d');
const lcdPixels = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);
const annSpans = [...$('ann').children];
let lastLcdKey = '';

function drawLCD() {
  const on = powered && bus.displayOn;
  if (on) bus.renderLCD(lcdPixels); else lcdPixels.fill(0);
  const contrast = on ? bus.contrast : 8;
  const key = on + ':' + contrast + ':' + lcdPixels.join('');
  if (key !== lastLcdKey) {
    lastLcdKey = key;
    const ctx = lcdCtx;
    ctx.fillStyle = '#a7b893';
    ctx.fillRect(0, 0, LCD_WIDTH * DOT, LCD_HEIGHT * DOT);
    // 消えているドットもうっすら見える(液晶らしさ)
    ctx.fillStyle = '#9cad88';
    for (let y = 0; y < LCD_HEIGHT; y++) {
      for (let x = 0; x < LCD_WIDTH; x++) ctx.fillRect(x * DOT, y * DOT, DOT - 1, DOT - 1);
    }
    // コントラスト0〜15を濃さに対応させる(8が標準)
    const alpha = Math.min(1, 0.2 + contrast * 0.1);
    ctx.fillStyle = `rgba(34, 43, 30, ${alpha})`;
    for (let y = 0; y < LCD_HEIGHT; y++) {
      for (let x = 0; x < LCD_WIDTH; x++) {
        if (lcdPixels[y * LCD_WIDTH + x]) ctx.fillRect(x * DOT, y * DOT, DOT - 1, DOT - 1);
      }
    }
  }
  const ann = powered ? bus.lcdAnn : 0;
  annSpans.forEach((s, i) => s.classList.toggle('on', on && ((ann >> i) & 1) === 1));
}

// ---------------- 音 ----------------

let audio = null;
let audioOut = null;
let nextTime = 0;
let sampleCarry = 0;
let beepLevel = 0;

function ensureAudio() {
  if (!soundOn) return;
  if (!audio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio = new AC();
    const highpass = audio.createBiquadFilter(); // 直流分を取り除く
    highpass.type = 'highpass';
    highpass.frequency.value = 30;
    const gain = audio.createGain();
    gain.gain.value = 0.2;
    highpass.connect(gain).connect(audio.destination);
    audioOut = highpass;
  }
  if (audio.state === 'suspended') audio.resume();
}

// 1フレームぶんのブザーの記録を音にして再生予約する
function pushAudio(startCycle, cycles) {
  const events = bus.beepEvents;
  const playable = audio && audio.state === 'running' && soundOn && speed === 1;
  if (!playable || (events.length === 0 && beepLevel === 0)) {
    if (events.length) beepLevel = events[events.length - 1].level;
    events.length = 0;
    sampleCarry = 0;
    return;
  }
  const rate = audio.sampleRate;
  const exact = cycles * rate / CPU_HZ + sampleCarry;
  const n = Math.floor(exact);
  sampleCarry = exact - n;
  if (n <= 0) { events.length = 0; return; }

  const buffer = audio.createBuffer(1, n, rate);
  const data = buffer.getChannelData(0);
  let ei = 0;
  for (let i = 0; i < n; i++) {
    const c = startCycle + i * CPU_HZ / rate;
    while (ei < events.length && events[ei].cycle <= c) beepLevel = events[ei++].level;
    data[i] = beepLevel ? 1 : 0;
  }
  while (ei < events.length) beepLevel = events[ei++].level;
  events.length = 0;

  const now = audio.currentTime;
  if (nextTime < now + 0.02) nextTime = now + 0.05;  // 途切れていたら少し先から
  if (nextTime > now + 0.3) return;                   // 遅れすぎたら捨てる
  const src = audio.createBufferSource();
  src.buffer = buffer;
  src.connect(audioOut);
  src.start(nextTime);
  nextTime += n / rate;
}

// ---------------- 実行ループ ----------------

const breakpoints = new Set();
let lastTime = performance.now();
let backlog = 0;
let framesSinceDebug = 0;
let speedWindowStart = performance.now();
let speedWindowCycles = 0;
let measuredMHz = 0;

function runOneFrame() {
  const start = bus.cycles;
  const done = machine.runFrame(breakpoints.size ? breakpoints : null);
  speedWindowCycles += done;
  pushAudio(start, done);
  if (machine.breakHit) {
    setRunning(false);
    setStatus(t('breakHit', { addr: hex4(cpu.pc) }));
  }
}

function loop(now) {
  const dt = Math.min(now - lastTime, 100);
  lastTime = now;
  if (powered && running) {
    backlog += dt * speed;
    const frameMs = 1000 / FPS;
    let frames = 0;
    while (backlog >= frameMs && running) {
      backlog -= frameMs;
      processKeys();
      runOneFrame();
      if (++frames >= 40) { backlog = 0; break; }
    }
    framesSinceDebug += frames;
    if (framesSinceDebug >= 10) { framesSinceDebug = 0; updateDebug(); }
  }
  if (now - speedWindowStart >= 1000) {
    measuredMHz = speedWindowCycles / ((now - speedWindowStart) * 1000);
    speedWindowStart = now;
    speedWindowCycles = 0;
  }
  drawLCD();
  requestAnimationFrame(loop);
}

// ---------------- 操作 ----------------

function setPowered(on) {
  powered = on;
  const b = $('power');
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? t('powerOn') : t('powerOff');
  if (on) {
    machine.powerOn({ keepRAM: keepRam });
    setRunning(true);
    setStatus(t('started', { rom: romName }));
  } else {
    saveRamIfNeeded();
    if (!keepRam) bus.clearRAM();
    setStatus(t('poweredOff'));
  }
  updateDebug();
}

function setRunning(on) {
  running = on;
  backlog = 0;
  $('dbgRun').textContent = on ? t('pause') : t('run');
  $('dbgStep').disabled = on;
  $('dbgFrame').disabled = on;
  updateDebug();
}

$('power').addEventListener('click', () => { ensureAudio(); setPowered(!powered); });

$('reset').addEventListener('click', () => {
  ensureAudio();
  if (!powered) { setPowered(true); return; }
  machine.reset();
  setStatus(t('resetDone'));
  updateDebug();
});

// RAMを消去して起動し直す(コールドスタート)。RAMを残す設定でも、プログラムと変数を全部消したいときに使う
$('clearRam').addEventListener('click', () => {
  if (!window.confirm(t('clearRamConfirm'))) return;
  ensureAudio();
  store.remove('ram');
  bus.clearRAM();
  setPowered(true);
  setStatus(t('ramCleared', { rom: romName }));
});

$('romLoad').addEventListener('click', () => $('romFile').click());
$('romFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!loadRomBytes(bytes, file.name)) return;
  const saved = store.set('rom', toBase64(bytes)) && store.set('romName', file.name);
  setPowered(true);
  setStatus(t('romLoaded', { name: file.name, size: num(bytes.length) })
    + (saved ? '' : t('romNotRemembered')));
});

$('romBuiltin').addEventListener('click', () => {
  store.remove('rom');
  store.remove('romName');
  loadRomBytes(fromBase64(BUILTIN_ROM_BASE64), t('builtinRom'));
  setPowered(true);
});

$('speed').addEventListener('change', (e) => { speed = Number(e.target.value); });

$('sound').addEventListener('change', (e) => {
  soundOn = e.target.checked;
  if (soundOn) ensureAudio();
});

$('vibrateOption').hidden = !canVibrate;
$('vibrate').checked = vibrateOn;
$('oneShotShift').checked = oneShotShift;
$('oneShotShift').addEventListener('change', (e) => {
  oneShotShift = e.target.checked;
  store.set('oneShotShift', oneShotShift ? '1' : '0');
  unlatchShift(); // 切り替えたときに効いたままにしない
});
$('vibrate').addEventListener('change', (e) => {
  vibrateOn = e.target.checked;
  store.set('vibrate', vibrateOn ? '1' : '0');
  if (vibrateOn) buzz(); // オンにしたことが手で分かるように一度だけ振動させる
});

$('keepRam').checked = keepRam;
$('keepRam').addEventListener('change', (e) => {
  keepRam = e.target.checked;
  store.set('keepRam', keepRam ? '1' : '0');
  if (!keepRam) store.remove('ram');
  else saveRamIfNeeded();
});

$('stateSave').addEventListener('click', () => {
  // 内蔵ROMの名前は言語によって違うので、名前ではなく印を保存する
  const name = romName === t('builtinRom') ? null : romName;
  const ok = store.set('state', JSON.stringify({ romName: name, machine: machine.saveState() }));
  setStatus(ok ? t('stateSaved') : t('stateSaveFailed'), !ok);
});

$('stateLoad').addEventListener('click', () => {
  const text = store.get('state');
  if (!text) { setStatus(t('stateMissing'), true); return; }
  try {
    const s = JSON.parse(text);
    machine.loadState(s.machine);
    releaseAllKeys();             // 時間が戻るので、キーの列と押した・離した時刻を捨てる
    keyQueue.reset();
    romName = s.romName || t('builtinRom');
    rememberTape();
    updateTapeInfo();
    if (!powered) {
      powered = true;
      $('power').setAttribute('aria-pressed', 'true');
      $('power').textContent = t('powerOn');
    }
    setStatus(t('stateLoaded'));
  } catch {
    let old = false;
    try { old = JSON.parse(text).machine.version === 1; } catch { /* 壊れている */ }
    setStatus(t(old ? 'stateOld' : 'stateBroken'), true);
  }
  updateDebug();
});

window.addEventListener('pagehide', saveRamIfNeeded);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveRamIfNeeded(); });

// ---------------- デバッガ ----------------

$('dbgRun').addEventListener('click', () => {
  if (!powered) return;
  if (running) { setRunning(false); return; }
  // ブレークポイントの上から再開するときは、まず1命令進めて同じ場所で止まらないようにする
  if (breakpoints.has(cpu.pc)) machine.step();
  setRunning(true);
  setStatus('');
});

$('dbgStep').addEventListener('click', () => {
  if (!powered || running) return;
  const start = bus.cycles;
  const c = machine.step();
  pushAudio(start, c);
  updateDebug();
});

$('dbgFrame').addEventListener('click', () => {
  if (!powered || running) return;
  if (breakpoints.has(cpu.pc)) machine.step();
  runOneFrame();
  updateDebug();
});

function parseHex(text) {
  const t = text.trim().replace(/^(\$|0x)/i, '');
  if (!/^[0-9a-f]{1,4}$/i.test(t)) return null;
  return parseInt(t, 16);
}

$('bpAdd').addEventListener('click', () => {
  const a = parseHex($('bpAddr').value);
  if (a === null) { setStatus(t('breakpointInvalid'), true); return; }
  breakpoints.add(a);
  $('bpAddr').value = '';
  updateDebug();
});
$('bpAddr').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('bpAdd').click(); });
$('bpClear').addEventListener('click', () => { breakpoints.clear(); updateDebug(); });
$('memAddr').addEventListener('input', updateDebug);

$('dbgToggle').addEventListener('click', () => {
  const show = !document.body.classList.contains('show-debug');
  document.body.classList.toggle('show-debug', show);
  $('dbgToggle').textContent = show ? t('hideDebugger') : t('showDebugger');
  $('dbgToggle').setAttribute('aria-expanded', String(show));
  if (show) {
    updateDebug();
    $('debug').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

const debugPanel = $('debug');
const debugVisible = () => debugPanel.offsetParent !== null;

function updateDebug() {
  if (!debugVisible()) return;
  const state = !powered ? t('stateOff')
    : cpu.stopped ? t('stateStopped')
      : !running ? (cpu.waiting ? t('statePausedWai') : t('statePaused'))
        : cpu.waiting ? t('stateRunningWai') : t('stateRunning');
  const mhz = powered && running ? `${UI_LANG === 'ja' ? '、' : ', '}${measuredMHz.toFixed(2)} MHz` : '';
  $('dbgState').innerHTML = `<b>${state}</b>${mhz}`;

  const regs = [['PC', hex4(cpu.pc)], ['A', hex2(cpu.a)], ['X', hex2(cpu.x)], ['Y', hex2(cpu.y)],
    ['S', hex2(cpu.s)], ['P', hex2(cpu.p)]];
  $('regs').innerHTML = regs.map(([n, v]) => `<div><span>${n}</span>${v}</div>`).join('');

  const flags = [['N', F_N], ['V', F_V], ['-', 0x20], ['B', F_B], ['D', F_D], ['I', F_I], ['Z', F_Z], ['C', F_C]];
  $('flags').innerHTML = flags.map(([n, f]) => `<span class="${cpu.p & f ? '' : 'off'}">${n}</span>`).join('');
  $('cycles').textContent = t('cyclesTotal', { n: num(cpu.cycles) });

  const read = (a) => bus.peek(a); // TAPE_DATA を読んでもテープが進まないように
  const lines = [];
  let addr = cpu.pc;
  for (let i = 0; i < 10; i++) {
    const d = disassemble(read, addr);
    const bytes = d.bytes.map(hex2).join(' ').padEnd(9);
    const mark = breakpoints.has(addr) ? '●' : ' ';
    const line = `${mark}${hex4(addr)}  ${bytes} ${d.text}`;
    const cls = [i === 0 ? 'cur' : '', breakpoints.has(addr) ? 'bp' : ''].join(' ').trim();
    lines.push(cls ? `<span class="${cls}">${line}</span>` : line);
    addr = (addr + d.length) & 0xffff;
  }
  $('code').innerHTML = lines.join('\n');

  $('bps').textContent = breakpoints.size
    ? t('breakpointList', { list: [...breakpoints].sort((a, b) => a - b).map((a) => '$' + hex4(a)).join(', ') })
    : '';

  const start = (parseHex($('memAddr').value) ?? 0x0400) & 0xfff8;
  const rows = [];
  for (let r = 0; r < 8; r++) {
    const base = (start + r * 8) & 0xffff;
    const bytes = [];
    let text = '';
    for (let i = 0; i < 8; i++) {
      const v = bus.peek((base + i) & 0xffff);
      bytes.push(hex2(v));
      text += v >= 0x20 && v < 0x7f ? String.fromCharCode(v) : '.';
    }
    rows.push(`${hex4(base)}  ${bytes.join(' ')}  ${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}`);
  }
  $('mem').innerHTML = rows.join('\n');
}

// ---------------- 起動 ----------------

document.addEventListener('pointerdown', ensureAudio, { once: false });
buildKeyboard();
restoreTape();
updateTapeInfo();
startUp();
setRunning(true);
requestAnimationFrame(loop);
