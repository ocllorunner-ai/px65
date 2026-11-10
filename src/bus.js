// PX-65 エミュレーター: メモリマップとI/O
//
//   $0000-$7FFF  RAM 32KB(VRAMは $0400-$057F)
//   $8000-$80FF  I/O
//   $8100-$9FFF  未使用(読むと $FF)
//   $A000-$FFFF  ROM 24KB(書き込みは無視)

export const RAM_SIZE = 0x8000;
export const ROM_BASE = 0xa000;
export const ROM_SIZE = 0x6000;
export const IO_BASE = 0x8000;
export const IO_END = 0x80ff;
export const VRAM_BASE = 0x0400;

export const LCD_WIDTH = 96;
export const LCD_HEIGHT = 32;

// I/Oレジスタのアドレス
export const KEY_ROW = 0x8000;
export const KEY_COL = 0x8001;
export const LCD_ANN = 0x8002;
export const LCD_CTRL = 0x8003;
export const TIMER_CTRL = 0x8010;
export const BEEP = 0x8020;
export const TAPE_DATA = 0x8030;
export const TAPE_CTRL = 0x8031;

// TAPE_CTRL に書くコマンドと、読み出したときのビット
export const TAPE_STOP = 0x00;
export const TAPE_PLAY = 0x01;    // 先頭に戻して読み出しを始める
export const TAPE_RECORD = 0x02;  // テープを消して書き込みを始める
export const TAPE_APPEND = 0x03;  // 中身を残したまま、最後から書き込みを始める
export const TAPE_CANCEL = 0x04;  // 録音をやめ、録音を始める前の中身に戻す
export const TAPE_ST_PLAY = 0x01; // 再生中
export const TAPE_ST_REC = 0x02;  // 録音中
export const TAPE_ST_FULL = 0x20; // 録音中で、テープがいっぱいで書けなかったバイトがある
export const TAPE_ST_EOT = 0x40;  // 再生中で、もう読むデータがない
export const TAPE_ST_READY = 0x80; // 再生中で、TAPE_DATA から次のバイトを読める
export const TAPE_MAX = 0x10000;   // テープの最大バイト数

export const CPU_HZ = 1_000_000;
export const TIMER_PERIOD = 15_625; // 64Hz

export class Bus {
  constructor() {
    this.ram = new Uint8Array(RAM_SIZE);
    this.rom = new Uint8Array(ROM_SIZE).fill(0xff);
    this.keys = new Uint8Array(8); // 行ごとに、押されている列のビットが1
    this.cycles = 0;               // バスが知っている累計サイクル数(ブザーの記録に使う)
    this.beepEvents = [];          // { cycle, level } ブザー出力が変化したサイクル
    this.tape = new Uint8Array(0); // 仮想テープの中身
    this.tapeMode = TAPE_STOP;
    this.tapePos = 0;              // 再生中に次に読む位置
    this.tapeRec = [];             // 録音中のデータ
    this.tapeFull = false;         // 録音中に、いっぱいで書けなかったバイトがある
    this.onTapeRecorded = null;    // 録音を止めたときに呼ぶ関数(中身を受け取る)
    this.resetIO();
  }

  // I/Oレジスタを電源投入時の状態(すべて0)に戻す
  resetIO() {
    this.keyRow = 0;
    this.lcdAnn = 0;
    this.lcdCtrl = 0;
    this.timerEnable = false;
    this.timerPending = false;
    this.timerCount = 0;
    this.beepLevel = 0;
    this.stopTape();
  }

  clearRAM() { this.ram.fill(0); }

  // ROMを読み込む。24KBより小さいときは末尾にそろえる(ベクタが $FFFA-$FFFF に来るように)
  loadROM(data) {
    if (data.length > ROM_SIZE) throw new Error(`ROM is too large: ${data.length} bytes (max ${ROM_SIZE})`);
    this.rom.fill(0xff);
    this.rom.set(data, ROM_SIZE - data.length);
  }

  // IRQ線の状態
  get irq() { return this.timerEnable && this.timerPending; }

  // CPUが進んだサイクル数を受け取り、タイマーを進める
  tick(cycles) {
    this.cycles += cycles;
    this.timerCount += cycles;
    while (this.timerCount >= TIMER_PERIOD) {
      this.timerCount -= TIMER_PERIOD;
      this.timerPending = true;
    }
  }

  read(addr) {
    if (addr < RAM_SIZE) return this.ram[addr];
    if (addr >= ROM_BASE) return this.rom[addr - ROM_BASE];
    if (addr <= IO_END) return this.readIO(addr);
    return 0xff;
  }

  write(addr, v) {
    if (addr < RAM_SIZE) { this.ram[addr] = v; return; }
    if (addr >= IO_BASE && addr <= IO_END) this.writeIO(addr, v);
    // ROMと未使用領域への書き込みは無視
  }

  readIO(addr) {
    switch (addr) {
      case KEY_ROW: return this.keyRow;
      case KEY_COL: {
        // 選ばれた(ビットが0の)行すべてについて、押されている列を0にする
        let cols = 0xff;
        for (let row = 0; row < 8; row++) {
          if (!(this.keyRow & (1 << row))) cols &= ~this.keys[row];
        }
        return cols & 0xff;
      }
      case LCD_ANN: return this.lcdAnn;
      case LCD_CTRL: return this.lcdCtrl;
      case TIMER_CTRL: return (this.timerEnable ? 0x01 : 0) | (this.timerPending ? 0x80 : 0);
      case BEEP: return 0xff;      // 書き込み専用
      case TAPE_DATA: {
        // 読むと次のバイトに進む
        if (this.tapeMode !== TAPE_PLAY || this.tapePos >= this.tape.length) return 0xff;
        return this.tape[this.tapePos++];
      }
      case TAPE_CTRL: return this.tapeStatus();
      default: return 0xff;
    }
  }

  writeIO(addr, v) {
    switch (addr) {
      case KEY_ROW: this.keyRow = v; break;
      case LCD_ANN: this.lcdAnn = v; break;
      case LCD_CTRL: this.lcdCtrl = v; break;
      case TIMER_CTRL:
        this.timerEnable = (v & 0x01) !== 0;
        if (v & 0x80) this.timerPending = false;
        break;
      case BEEP: {
        const level = v & 0x01;
        if (level !== this.beepLevel) {
          this.beepLevel = level;
          this.beepEvents.push({ cycle: this.cycles, level });
        }
        break;
      }
      case TAPE_DATA:
        if (this.tapeMode === TAPE_RECORD) {
          if (this.tapeRec.length < TAPE_MAX) this.tapeRec.push(v);
          else this.tapeFull = true;
        }
        break;
      case TAPE_CTRL:
        if (v === TAPE_CANCEL) {        // 録音した分を捨てる(テープの中身は録音前のまま)
          this.tapeRec = [];
          this.tapeMode = TAPE_STOP;
          this.tapePos = 0;
          this.tapeFull = false;
          break;
        }
        this.stopTape();
        switch (v & 0x03) {
          case TAPE_RECORD:
            this.tapeMode = TAPE_RECORD;
            this.tapeRec = [];
            break;
          case TAPE_APPEND:
            this.tapeMode = TAPE_RECORD;
            this.tapeRec = Array.from(this.tape);
            break;
          case TAPE_PLAY:
            this.tapeMode = TAPE_PLAY;
            this.tapePos = 0;
            break;
        }
        break;
      // KEY_COL(読み出し専用)と未定義アドレスへの書き込みは無視
    }
  }

  // 読み出しと同じ値を返すが、何も変えない(デバッガ用)。TAPE_DATA を読んでもテープが進まない
  peek(addr) {
    if (addr === TAPE_DATA) {
      return this.tapeMode === TAPE_PLAY && this.tapePos < this.tape.length ? this.tape[this.tapePos] : 0xff;
    }
    return this.read(addr);
  }

  tapeStatus() {
    if (this.tapeMode === TAPE_RECORD) return TAPE_ST_REC | (this.tapeFull ? TAPE_ST_FULL : 0);
    if (this.tapeMode !== TAPE_PLAY) return 0;
    return TAPE_ST_PLAY | (this.tapePos < this.tape.length ? TAPE_ST_READY : TAPE_ST_EOT);
  }

  // テープを止める。録音中だったら、録音した内容をテープの中身にする
  stopTape() {
    if (this.tapeMode === TAPE_RECORD) {
      this.tape = Uint8Array.from(this.tapeRec);
      this.tapeRec = [];
      this.tapeMode = TAPE_STOP;
      this.onTapeRecorded?.(this.tape);
    }
    this.tapeMode = TAPE_STOP;
    this.tapePos = 0;
    this.tapeFull = false;
  }

  // ---- 外部(キーボードUIなど)から使う ----

  // テープを入れ替える(止めてから)。空の配列なら取り出したのと同じ
  insertTape(bytes) {
    if (bytes.length > TAPE_MAX) throw new Error(`tape is too large: ${bytes.length} bytes (max ${TAPE_MAX})`);
    this.tapeMode = TAPE_STOP;
    this.tapeRec = [];
    this.tapePos = 0;
    this.tapeFull = false;
    this.tape = Uint8Array.from(bytes);
  }

  setKey(row, col, pressed) {
    if (pressed) this.keys[row] |= 1 << col;
    else this.keys[row] &= ~(1 << col);
  }

  get displayOn() { return (this.lcdCtrl & 0x01) !== 0; }
  get contrast() { return (this.lcdCtrl >> 4) & 0x0f; }

  // 画面のドットを 96×32 の配列(1なら点灯)で返す。表示オフならすべて0
  renderLCD(out = new Uint8Array(LCD_WIDTH * LCD_HEIGHT)) {
    if (!this.displayOn) { out.fill(0); return out; }
    for (let page = 0; page < 4; page++) {
      for (let x = 0; x < LCD_WIDTH; x++) {
        const b = this.ram[VRAM_BASE + page * LCD_WIDTH + x];
        for (let bit = 0; bit < 8; bit++) {
          out[(page * 8 + bit) * LCD_WIDTH + x] = (b >> bit) & 1;
        }
      }
    }
    return out;
  }
}
