// 押す・離すをエミュレーターの時間に合わせてキーマトリクスに反映する
//
// ROMはキーボードを1/64秒(15,625サイクル)ごとに読む。速く打たれても読み落とさないように、
// 押す・離すをいったん列に入れ、エミュレーターの時間で次を守って反映する:
//   押したキーは2回読まれるまで離さない。離したキーは1回読まれるまで押さない。順番は変えない
// PCで記号を打ったときは、その記号に必要な SHIFT の状態を、そのキーを押したときに合わせる

// キーマトリクス(仕様書の表と同じ)。null は未使用
export const KEY_MATRIX = [
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  ['I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'],
  ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X'],
  ['Y', 'Z', 'SPACE', 'RET', 'SHIFT', 'DEL', ',', '.'],
  ['0', '1', '2', '3', '4', '5', '6', '7'],
  ['8', '9', '+', '-', '*', '/', '=', null],
  ['LEFT', 'RIGHT', 'UP', 'DOWN', null, null, null, null],
];
// キー名 -> [行, 列]
export const KEY_POSITION = new Map();
KEY_MATRIX.forEach((row, r) => row.forEach((name, c) => { if (name) KEY_POSITION.set(name, [r, c]); }));

export const SCAN_CYCLES = 15625;
export const HOLD_CYCLES = SCAN_CYCLES * 2 + 500;
export const GAP_CYCLES = SCAN_CYCLES + 500;

export class KeyQueue {
  // bus: setKey(row, col, on) と cycles を持つもの。position: キー名 -> [行, 列]
  constructor(bus, position) {
    this.bus = bus;
    this.position = position;
    this.queue = [];             // { down, name, shift }(shift: true/false = 記号に必要な SHIFT、null = 指定なし)
    this.downAt = new Map();     // キー名 -> マトリクスで押したときのサイクル数
    this.upAt = new Map();       // キー名 -> マトリクスで離したときのサイクル数
    this.shiftHeld = false;      // SHIFT キーが押されているか
    this.forced = null;          // 最後に押した記号のキーが必要とする SHIFT(null なら shiftHeld に従う)
    this.forcedKey = null;
  }

  // wait: 時間を守るか(エミュレーターが止まっているときは待たない)
  push(down, name, shift, wait) {
    this.queue.push({ down, name, shift });
    this.process(wait);
  }

  // 列の先頭から、条件を満たしたものをマトリクスに反映する(フレームごとにも呼ぶ)
  process(wait) {
    const now = this.bus.cycles;
    while (this.queue.length) {
      const ev = this.queue[0];
      if (ev.down) {
        if (wait && this.tooSoon(this.upAt, ev.name, now, GAP_CYCLES)) break;
        this.setMatrix(ev.name, true);
        this.downAt.set(ev.name, now);
        if (ev.name !== 'SHIFT') { this.forced = ev.shift; this.forcedKey = ev.name; }
      } else {
        if (wait && this.tooSoon(this.downAt, ev.name, now, HOLD_CYCLES)) break;
        this.setMatrix(ev.name, false);
        this.upAt.set(ev.name, now);
        if (this.forcedKey === ev.name) { this.forced = null; this.forcedKey = null; }
      }
      this.queue.shift();
    }
    this.applyShift();
  }

  // times に記録した時刻から、まだ cycles たっていないか。
  // 記録が今より後なら(状態を読み込んで時間が戻ったなど)、その記録は使わない
  tooSoon(times, name, now, cycles) {
    const t = times.get(name);
    if (t === undefined) return false;
    if (t > now) { times.delete(name); return false; }
    return now - t < cycles;
  }

  setMatrix(name, on) {
    if (name === 'SHIFT') { this.shiftHeld = on; return; }
    const pos = this.position.get(name);
    if (pos) this.bus.setKey(pos[0], pos[1], on);
  }

  applyShift() {
    const pos = this.position.get('SHIFT');
    this.bus.setKey(pos[0], pos[1], this.forced !== null ? this.forced : this.shiftHeld);
  }

  // 列を捨て、すべてのキーを離す
  releaseAll() {
    this.queue.length = 0;
    for (const name of this.position.keys()) this.setMatrix(name, false);
    this.shiftHeld = false;
    this.forced = null;
    this.forcedKey = null;
    this.applyShift();
  }

  // releaseAll に加えて、押した・離した時刻も忘れる(状態の読み込みで時間が変わったとき)
  reset() {
    this.releaseAll();
    this.downAt.clear();
    this.upAt.clear();
  }
}
