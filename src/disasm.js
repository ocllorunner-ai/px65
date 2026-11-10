// PX-65 エミュレーター: 逆アセンブラ(デバッガ用)
//
//   const { text, length } = disassemble(read, addr);
//   read(addr) はバスの読み出し。I/Oの読み出しに副作用がないので、そのまま使える

import { OPCODES } from './cpu65c02.js';

const hex2 = (v) => '$' + v.toString(16).toUpperCase().padStart(2, '0');
const hex4 = (v) => '$' + v.toString(16).toUpperCase().padStart(4, '0');

const LENGTH = { imp: 1, acc: 1, n1: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, izx: 2, izy: 2, izp: 2,
  rel: 2, n2: 2, abs: 3, abx: 3, aby: 3, ind: 3, aix: 3, zpr: 3, n3: 3 };

export function disassemble(read, addr) {
  const op = read(addr);
  const e = OPCODES[op];
  const b1 = read((addr + 1) & 0xffff);
  const b2 = read((addr + 2) & 0xffff);
  const w = b1 | (b2 << 8);
  const length = LENGTH[e.mode];
  const bitOp = ['RMB', 'SMB', 'BBR', 'BBS'].includes(e.name);
  const name = bitOp ? e.name + ((op >> 4) & 7) : e.name;
  const rel = (off, next) => hex4((next + ((off ^ 0x80) - 0x80)) & 0xffff);

  let operand;
  switch (e.mode) {
    case 'imp': case 'n1': operand = ''; break;
    case 'acc': operand = 'A'; break;
    case 'imm': operand = '#' + hex2(b1); break;
    case 'zp': operand = hex2(b1); break;
    case 'zpx': operand = hex2(b1) + ',X'; break;
    case 'zpy': operand = hex2(b1) + ',Y'; break;
    case 'izx': operand = `(${hex2(b1)},X)`; break;
    case 'izy': operand = `(${hex2(b1)}),Y`; break;
    case 'izp': operand = `(${hex2(b1)})`; break;
    case 'abs': operand = hex4(w); break;
    case 'abx': operand = hex4(w) + ',X'; break;
    case 'aby': operand = hex4(w) + ',Y'; break;
    case 'ind': operand = `(${hex4(w)})`; break;
    case 'aix': operand = `(${hex4(w)},X)`; break;
    case 'rel': operand = rel(b1, (addr + 2) & 0xffff); break;
    case 'zpr': operand = `${hex2(b1)},${rel(b2, (addr + 3) & 0xffff)}`; break;
    case 'n2': operand = hex2(b1); break;
    case 'n3': operand = hex4(w); break;
  }
  const bytes = [op, b1, b2].slice(0, length);
  return { text: operand ? `${name} ${operand}` : name, length, bytes };
}
