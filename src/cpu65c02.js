// PX-65 エミュレーター: WDC 65C02 CPUコア
//
// - WDC 65C02の全命令(RMB/SMB/BBR/BBS、WAI/STPを含む)
// - 命令ごとのサイクル数(ページ境界越え、分岐成立、10進モードの追加サイクルを含む)
// - リセット、IRQ(レベル)、NMI(エッジ)、WAI、STP
// - 未定義命令は65C02の仕様どおり、決まった長さとサイクル数のNOPとして動く
//
// バスは { read(addr), write(addr, value) } を持つオブジェクト。
// ダミーリード(実機が捨てる読み出し)は行わないので、I/Oの読み出しに副作用があっても安全。

export const F_C = 0x01; // キャリー
export const F_Z = 0x02; // ゼロ
export const F_I = 0x04; // 割り込み禁止
export const F_D = 0x08; // 10進モード
export const F_B = 0x10; // BRK(スタックに積んだ値にだけ意味がある)
export const F_U = 0x20; // 常に1
export const F_V = 0x40; // オーバーフロー
export const F_N = 0x80; // ネガティブ

// 命令表: "オペコード ニーモニック アドレッシング サイクル数"
// サイクル数の後ろの * は、ページ境界を越えたら1サイクル追加の意味。
//
// アドレッシング:
//   imp 暗黙  acc アキュムレーター  imm 即値  zp ゼロページ  zpx/zpy ゼロページ,X/Y
//   abs 絶対  abx/aby 絶対,X/Y  ind (絶対)  aix (絶対,X)  izx (ZP,X)  izy (ZP),Y
//   izp (ZP)  rel 相対  zpr ZP+相対(BBR/BBS)
//   n1/n2/n3 未定義命令のNOP(1/2/3バイト)
const SPEC = `
00 BRK imp 7   01 ORA izx 6   02 NOP n2 2    04 TSB zp 5    05 ORA zp 3    06 ASL zp 5    08 PHP imp 3
09 ORA imm 2   0A ASL acc 2   0C TSB abs 6   0D ORA abs 4   0E ASL abs 6
10 BPL rel 2   11 ORA izy 5*  12 ORA izp 5   14 TRB zp 5    15 ORA zpx 4   16 ASL zpx 6   18 CLC imp 2
19 ORA aby 4*  1A INC acc 2   1C TRB abs 6   1D ORA abx 4*  1E ASL abx 6*
20 JSR abs 6   21 AND izx 6   22 NOP n2 2    24 BIT zp 3    25 AND zp 3    26 ROL zp 5    28 PLP imp 4
29 AND imm 2   2A ROL acc 2   2C BIT abs 4   2D AND abs 4   2E ROL abs 6
30 BMI rel 2   31 AND izy 5*  32 AND izp 5   34 BIT zpx 4   35 AND zpx 4   36 ROL zpx 6   38 SEC imp 2
39 AND aby 4*  3A DEC acc 2   3C BIT abx 4*  3D AND abx 4*  3E ROL abx 6*
40 RTI imp 6   41 EOR izx 6   42 NOP n2 2    44 NOP n2 3    45 EOR zp 3    46 LSR zp 5    48 PHA imp 3
49 EOR imm 2   4A LSR acc 2   4C JMP abs 3   4D EOR abs 4   4E LSR abs 6
50 BVC rel 2   51 EOR izy 5*  52 EOR izp 5   54 NOP n2 4    55 EOR zpx 4   56 LSR zpx 6   58 CLI imp 2
59 EOR aby 4*  5A PHY imp 3   5C NOP n3 8    5D EOR abx 4*  5E LSR abx 6*
60 RTS imp 6   61 ADC izx 6   62 NOP n2 2    64 STZ zp 3    65 ADC zp 3    66 ROR zp 5    68 PLA imp 4
69 ADC imm 2   6A ROR acc 2   6C JMP ind 6   6D ADC abs 4   6E ROR abs 6
70 BVS rel 2   71 ADC izy 5*  72 ADC izp 5   74 STZ zpx 4   75 ADC zpx 4   76 ROR zpx 6   78 SEI imp 2
79 ADC aby 4*  7A PLY imp 4   7C JMP aix 6   7D ADC abx 4*  7E ROR abx 6*
80 BRA rel 2   81 STA izx 6   82 NOP n2 2    84 STY zp 3    85 STA zp 3    86 STX zp 3    88 DEY imp 2
89 BIT imm 2   8A TXA imp 2   8C STY abs 4   8D STA abs 4   8E STX abs 4
90 BCC rel 2   91 STA izy 6   92 STA izp 5   94 STY zpx 4   95 STA zpx 4   96 STX zpy 4   98 TYA imp 2
99 STA aby 5   9A TXS imp 2   9C STZ abs 4   9D STA abx 5   9E STZ abx 5
A0 LDY imm 2   A1 LDA izx 6   A2 LDX imm 2   A4 LDY zp 3    A5 LDA zp 3    A6 LDX zp 3    A8 TAY imp 2
A9 LDA imm 2   AA TAX imp 2   AC LDY abs 4   AD LDA abs 4   AE LDX abs 4
B0 BCS rel 2   B1 LDA izy 5*  B2 LDA izp 5   B4 LDY zpx 4   B5 LDA zpx 4   B6 LDX zpy 4   B8 CLV imp 2
B9 LDA aby 4*  BA TSX imp 2   BC LDY abx 4*  BD LDA abx 4*  BE LDX aby 4*
C0 CPY imm 2   C1 CMP izx 6   C2 NOP n2 2    C4 CPY zp 3    C5 CMP zp 3    C6 DEC zp 5    C8 INY imp 2
C9 CMP imm 2   CA DEX imp 2   CB WAI imp 3   CC CPY abs 4   CD CMP abs 4   CE DEC abs 6
D0 BNE rel 2   D1 CMP izy 5*  D2 CMP izp 5   D4 NOP n2 4    D5 CMP zpx 4   D6 DEC zpx 6   D8 CLD imp 2
D9 CMP aby 4*  DA PHX imp 3   DB STP imp 3   DC NOP n3 4    DD CMP abx 4*  DE DEC abx 7
E0 CPX imm 2   E1 SBC izx 6   E2 NOP n2 2    E4 CPX zp 3    E5 SBC zp 3    E6 INC zp 5    E8 INX imp 2
E9 SBC imm 2   EA NOP imp 2   EC CPX abs 4   ED SBC abs 4   EE INC abs 6
F0 BEQ rel 2   F1 SBC izy 5*  F2 SBC izp 5   F4 NOP n2 4    F5 SBC zpx 4   F6 INC zpx 6   F8 SED imp 2
F9 SBC aby 4*  FA PLX imp 4   FC NOP n3 4    FD SBC abx 4*  FE INC abx 7
`;

function buildTable() {
  const table = new Array(256);
  const re = /([0-9A-F]{2}) (\w{3}) (\w+) (\d)(\*?)/g;
  let m;
  while ((m = re.exec(SPEC))) {
    table[parseInt(m[1], 16)] = {
      name: m[2], mode: m[3], cycles: Number(m[4]), penalty: m[5] === '*',
    };
  }
  for (let n = 0; n < 8; n++) {
    // RMBn/SMBn: x7, BBRn/BBSn: xF
    table[(n << 4) | 0x07] = { name: 'RMB', mode: 'zp', cycles: 5, penalty: false };
    table[((n + 8) << 4) | 0x07] = { name: 'SMB', mode: 'zp', cycles: 5, penalty: false };
    table[(n << 4) | 0x0f] = { name: 'BBR', mode: 'zpr', cycles: 5, penalty: false };
    table[((n + 8) << 4) | 0x0f] = { name: 'BBS', mode: 'zpr', cycles: 5, penalty: false };
  }
  // 残りの未定義命令(x3列と、WAI/STP以外のxB列)は1バイト1サイクルのNOP
  for (let op = 0; op < 256; op++) {
    if (!table[op]) table[op] = { name: 'NOP', mode: 'n1', cycles: 1, penalty: false };
  }
  return table;
}

export const OPCODES = buildTable();

export class CPU65C02 {
  constructor(bus) {
    this.bus = bus;
    this.a = 0; this.x = 0; this.y = 0;
    this.s = 0xfd;
    this.p = F_U | F_B | F_I;
    this.pc = 0;
    this.cycles = 0;          // 起動からの累計サイクル数
    this.irq = false;         // IRQ線の状態(レベル)。システム側が毎回セットする
    this.nmiPending = false;  // NMIはエッジで受け付ける
    this.waiting = false;     // WAIで停止中
    this.stopped = false;     // STPで停止中
    this._crossed = false;
  }

  // ---- 外部から使うメソッド ----

  reset() {
    this.s = 0xfd;
    this.p = (this.p | F_I | F_U | F_B) & ~F_D;
    this.waiting = false;
    this.stopped = false;
    this.nmiPending = false;
    this.pc = this.read16(0xfffc);
    this.cycles += 7;
  }

  nmi() { this.nmiPending = true; }

  setIRQ(level) { this.irq = !!level; }

  // 1命令(または割り込みの受け付け)を実行し、かかったサイクル数を返す
  step() {
    const start = this.cycles;

    if (this.stopped) { this.cycles += 1; return 1; }

    if (this.waiting) {
      if (this.nmiPending || this.irq) {
        this.waiting = false;
      } else {
        this.cycles += 1;
        return 1;
      }
    }

    if (this.nmiPending) {
      this.nmiPending = false;
      this.interrupt(0xfffa, false);
      return this.cycles - start;
    }
    if (this.irq && !(this.p & F_I)) {
      this.interrupt(0xfffe, false);
      return this.cycles - start;
    }

    const op = this.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    const e = OPCODES[op];
    this._crossed = false;
    const addr = this.resolve(e.mode);
    this.cycles += e.cycles;
    if (e.penalty && this._crossed) this.cycles += 1;
    this.execute(e.name, op, addr, e.mode);
    return this.cycles - start;
  }

  // ---- バスとスタック ----

  read(addr) { return this.bus.read(addr & 0xffff) & 0xff; }
  write(addr, v) { this.bus.write(addr & 0xffff, v & 0xff); }
  read16(addr) { return this.read(addr) | (this.read((addr + 1) & 0xffff) << 8); }
  readZP16(zp) { return this.read(zp & 0xff) | (this.read((zp + 1) & 0xff) << 8); }

  push(v) { this.write(0x100 | this.s, v); this.s = (this.s - 1) & 0xff; }
  pull() { this.s = (this.s + 1) & 0xff; return this.read(0x100 | this.s); }

  fetch() { const v = this.read(this.pc); this.pc = (this.pc + 1) & 0xffff; return v; }
  fetch16() { const v = this.read16(this.pc); this.pc = (this.pc + 2) & 0xffff; return v; }

  interrupt(vector, isBrk) {
    this.push(this.pc >> 8);
    this.push(this.pc & 0xff);
    this.push(isBrk ? (this.p | F_B | F_U) : ((this.p & ~F_B) | F_U));
    this.p = (this.p | F_I) & ~F_D; // 65C02は割り込みでDフラグをクリアする
    this.pc = this.read16(vector);
    if (!isBrk) this.cycles += 7;
  }

  // ---- アドレッシング ----

  resolve(mode) {
    switch (mode) {
      case 'imp': case 'acc': case 'n1':
        return -1;
      case 'imm': case 'rel': case 'zpr': {
        const a = this.pc;
        if (mode === 'imm') this.pc = (this.pc + 1) & 0xffff;
        return a; // rel/zprはオペランドの位置だけ返し、命令側で読む
      }
      case 'n2': this.pc = (this.pc + 1) & 0xffff; return -1;
      case 'n3': this.pc = (this.pc + 2) & 0xffff; return -1;
      case 'zp': return this.fetch();
      case 'zpx': return (this.fetch() + this.x) & 0xff;
      case 'zpy': return (this.fetch() + this.y) & 0xff;
      case 'abs': return this.fetch16();
      case 'abx': return this.indexed(this.fetch16(), this.x);
      case 'aby': return this.indexed(this.fetch16(), this.y);
      case 'ind': return this.read16(this.fetch16()); // 65C02はページ境界のバグなし
      case 'aix': return this.read16((this.fetch16() + this.x) & 0xffff);
      case 'izx': return this.readZP16(this.fetch() + this.x);
      case 'izy': return this.indexed(this.readZP16(this.fetch()), this.y);
      case 'izp': return this.readZP16(this.fetch());
      default: throw new Error(`unknown addressing mode: ${mode}`);
    }
  }

  indexed(base, index) {
    const a = (base + index) & 0xffff;
    if ((a & 0xff00) !== (base & 0xff00)) this._crossed = true;
    return a;
  }

  // ---- フラグ ----

  setNZ(v) {
    this.p = (this.p & ~(F_N | F_Z)) | (v & 0x80) | (v === 0 ? F_Z : 0);
    return v;
  }

  setFlag(flag, on) { if (on) this.p |= flag; else this.p &= ~flag; }

  // ---- 演算 ----

  adc(v) {
    const a = this.a, c = this.p & F_C;
    if (this.p & F_D) {
      this.cycles += 1; // 65C02は10進モードで1サイクル追加
      let lo = (a & 0x0f) + (v & 0x0f) + c;
      if (lo >= 0x0a) lo = ((lo + 0x06) & 0x0f) + 0x10;
      let r = (a & 0xf0) + (v & 0xf0) + lo;
      const signed = (a & 0xf0) - ((a & 0x80) << 1) + (v & 0xf0) - ((v & 0x80) << 1) + lo;
      this.setFlag(F_V, signed < -128 || signed > 127);
      if (r >= 0xa0) r += 0x60;
      this.setFlag(F_C, r >= 0x100);
      this.a = this.setNZ(r & 0xff);
    } else {
      const r = a + v + c;
      this.setFlag(F_V, (~(a ^ v) & (a ^ r) & 0x80) !== 0);
      this.setFlag(F_C, r > 0xff);
      this.a = this.setNZ(r & 0xff);
    }
  }

  sbc(v) {
    if (this.p & F_D) {
      this.cycles += 1;
      const a = this.a, c = this.p & F_C;
      const bin = a - v + c - 1;
      // C と V は2進の減算と同じ
      this.setFlag(F_V, ((a ^ v) & (a ^ bin) & 0x80) !== 0);
      this.setFlag(F_C, bin >= 0);
      const lo = (a & 0x0f) - (v & 0x0f) + c - 1;
      let r = bin;
      if (r < 0) r -= 0x60;
      if (lo < 0) r -= 0x06;
      this.a = this.setNZ(r & 0xff);
    } else {
      this.adc(v ^ 0xff);
    }
  }

  compare(reg, v) {
    const r = reg - v;
    this.setFlag(F_C, r >= 0);
    this.setNZ(r & 0xff);
  }

  branch(cond) {
    const off = this.fetch();
    if (!cond) return;
    const target = (this.pc + ((off ^ 0x80) - 0x80)) & 0xffff;
    this.cycles += 1;
    if ((target & 0xff00) !== (this.pc & 0xff00)) this.cycles += 1;
    this.pc = target;
  }

  // 読み書き命令(シフト、INC/DEC)。addr < 0 ならアキュムレーター
  rmw(addr, fn) {
    if (addr < 0) { this.a = fn(this.a); return; }
    this.write(addr, fn(this.read(addr)));
  }

  asl(v) { this.setFlag(F_C, v & 0x80); return this.setNZ((v << 1) & 0xff); }
  lsr(v) { this.setFlag(F_C, v & 0x01); return this.setNZ(v >> 1); }
  rol(v) { const c = this.p & F_C; this.setFlag(F_C, v & 0x80); return this.setNZ(((v << 1) | c) & 0xff); }
  ror(v) { const c = this.p & F_C; this.setFlag(F_C, v & 0x01); return this.setNZ((v >> 1) | (c << 7)); }

  // ---- 命令の実行 ----

  execute(name, op, addr, mode) {
    switch (name) {
      // 転送
      case 'LDA': this.a = this.setNZ(this.read(addr)); break;
      case 'LDX': this.x = this.setNZ(this.read(addr)); break;
      case 'LDY': this.y = this.setNZ(this.read(addr)); break;
      case 'STA': this.write(addr, this.a); break;
      case 'STX': this.write(addr, this.x); break;
      case 'STY': this.write(addr, this.y); break;
      case 'STZ': this.write(addr, 0); break;
      case 'TAX': this.x = this.setNZ(this.a); break;
      case 'TAY': this.y = this.setNZ(this.a); break;
      case 'TXA': this.a = this.setNZ(this.x); break;
      case 'TYA': this.a = this.setNZ(this.y); break;
      case 'TSX': this.x = this.setNZ(this.s); break;
      case 'TXS': this.s = this.x; break;

      // スタック
      case 'PHA': this.push(this.a); break;
      case 'PHX': this.push(this.x); break;
      case 'PHY': this.push(this.y); break;
      case 'PHP': this.push(this.p | F_B | F_U); break;
      case 'PLA': this.a = this.setNZ(this.pull()); break;
      case 'PLX': this.x = this.setNZ(this.pull()); break;
      case 'PLY': this.y = this.setNZ(this.pull()); break;
      case 'PLP': this.p = this.pull() | F_B | F_U; break;

      // 算術、論理
      case 'ADC': this.adc(this.read(addr)); break;
      case 'SBC': this.sbc(this.read(addr)); break;
      case 'AND': this.a = this.setNZ(this.a & this.read(addr)); break;
      case 'ORA': this.a = this.setNZ(this.a | this.read(addr)); break;
      case 'EOR': this.a = this.setNZ(this.a ^ this.read(addr)); break;
      case 'CMP': this.compare(this.a, this.read(addr)); break;
      case 'CPX': this.compare(this.x, this.read(addr)); break;
      case 'CPY': this.compare(this.y, this.read(addr)); break;
      case 'BIT': {
        const v = this.read(addr);
        this.setFlag(F_Z, (this.a & v) === 0);
        if (mode !== 'imm') this.p = (this.p & ~(F_N | F_V)) | (v & (F_N | F_V));
        break;
      }

      // 読み書き
      case 'ASL': this.rmw(addr, (v) => this.asl(v)); break;
      case 'LSR': this.rmw(addr, (v) => this.lsr(v)); break;
      case 'ROL': this.rmw(addr, (v) => this.rol(v)); break;
      case 'ROR': this.rmw(addr, (v) => this.ror(v)); break;
      case 'INC': this.rmw(addr, (v) => this.setNZ((v + 1) & 0xff)); break;
      case 'DEC': this.rmw(addr, (v) => this.setNZ((v - 1) & 0xff)); break;
      case 'INX': this.x = this.setNZ((this.x + 1) & 0xff); break;
      case 'INY': this.y = this.setNZ((this.y + 1) & 0xff); break;
      case 'DEX': this.x = this.setNZ((this.x - 1) & 0xff); break;
      case 'DEY': this.y = this.setNZ((this.y - 1) & 0xff); break;
      case 'TSB': {
        const v = this.read(addr);
        this.setFlag(F_Z, (this.a & v) === 0);
        this.write(addr, v | this.a);
        break;
      }
      case 'TRB': {
        const v = this.read(addr);
        this.setFlag(F_Z, (this.a & v) === 0);
        this.write(addr, v & ~this.a);
        break;
      }
      case 'RMB': this.write(addr, this.read(addr) & ~(1 << ((op >> 4) & 7))); break;
      case 'SMB': this.write(addr, this.read(addr) | (1 << ((op >> 4) & 7))); break;

      // 分岐
      case 'BPL': this.branch(!(this.p & F_N)); break;
      case 'BMI': this.branch(this.p & F_N); break;
      case 'BVC': this.branch(!(this.p & F_V)); break;
      case 'BVS': this.branch(this.p & F_V); break;
      case 'BCC': this.branch(!(this.p & F_C)); break;
      case 'BCS': this.branch(this.p & F_C); break;
      case 'BNE': this.branch(!(this.p & F_Z)); break;
      case 'BEQ': this.branch(this.p & F_Z); break;
      case 'BRA': this.branch(true); break;
      case 'BBR': case 'BBS': {
        const v = this.read(this.fetch());
        const bit = (v >> ((op >> 4) & 7)) & 1;
        this.branch(name === 'BBS' ? bit : !bit);
        break;
      }

      // ジャンプ、サブルーチン、割り込み
      case 'JMP': this.pc = addr; break;
      case 'JSR': {
        const ret = (this.pc - 1) & 0xffff;
        this.push(ret >> 8);
        this.push(ret & 0xff);
        this.pc = addr;
        break;
      }
      case 'RTS': this.pc = ((this.pull() | (this.pull() << 8)) + 1) & 0xffff; break;
      case 'RTI':
        this.p = this.pull() | F_B | F_U;
        this.pc = this.pull() | (this.pull() << 8);
        break;
      case 'BRK':
        this.pc = (this.pc + 1) & 0xffff; // BRKは2バイト命令扱い(署名バイトを飛ばす)
        this.interrupt(0xfffe, true);
        break;

      // フラグ
      case 'CLC': this.p &= ~F_C; break;
      case 'SEC': this.p |= F_C; break;
      case 'CLI': this.p &= ~F_I; break;
      case 'SEI': this.p |= F_I; break;
      case 'CLD': this.p &= ~F_D; break;
      case 'SED': this.p |= F_D; break;
      case 'CLV': this.p &= ~F_V; break;

      // その他
      case 'NOP': break;
      case 'WAI': this.waiting = true; break;
      case 'STP': this.stopped = true; break;

      default: throw new Error(`unimplemented: ${name}`);
    }
  }
}
