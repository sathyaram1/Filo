// Decoder QR "severo" per i test: rilegge la matrice prodotta da
// src/shared/qr.js come farebbe un vero scanner, ma SENZA tolleranza agli
// errori. Verifica:
//   1. che i format info dichiarino il livello ECC richiesto;
//   2. che i codeword si de-interlaccino secondo la struttura a blocchi
//      PREVISTA DALLO STANDARD per (versione, livello) — la tabella qui sotto
//      è una copia indipendente della spec ISO/IEC 18004, NON quella di qr.js;
//   3. che OGNI blocco Reed-Solomon abbia sindromi tutte a zero (parità
//      coerente coi dati: è quello che fallisce se la tabella RS del
//      generatore non combacia col livello dichiarato — il bug del feedback
//      #304, QR illeggibili dagli scanner reali);
//   4. che i byte dati decodificati siano ESATTAMENTE l'UTF-8 dell'input.
// Copre tutte le versioni 1-40 e tutti i livelli L/M/Q/H.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('../../src/shared/qr.js');
const SN_QR = globalThis.SN_QR;

// Tabella RS di riferimento (ISO/IEC 18004): per ogni versione 1-40, quattro
// definizioni-blocchi in ordine L, M, Q, H. Ogni definizione è una sequenza
// piatta di terne (numBlocchi, totalCodewords, dataCodewords).
const RS_REF = [
  [1,26,19], [1,26,16], [1,26,13], [1,26,9],
  [1,44,34], [1,44,28], [1,44,22], [1,44,16],
  [1,70,55], [1,70,44], [2,35,17], [2,35,13],
  [1,100,80], [2,50,32], [2,50,24], [4,25,9],
  [1,134,108], [2,67,43], [2,33,15,2,34,16], [2,33,11,2,34,12], // v1-v5
  [2,86,68], [4,43,27], [4,43,19], [4,43,15],
  [2,98,78], [4,49,31], [2,32,14,4,33,15], [4,39,13,1,40,14],
  [2,121,97], [2,60,38,2,61,39], [4,40,18,2,41,19], [4,40,14,2,41,15],
  [2,146,116], [3,58,36,2,59,37], [4,36,16,4,37,17], [4,36,12,4,37,13],
  [2,86,68,2,87,69], [4,69,43,1,70,44], [6,43,19,2,44,20], [6,43,15,2,44,16], // v6-v10
  [4,101,81], [1,80,50,4,81,51], [4,50,22,4,51,23], [3,36,12,8,37,13],
  [2,116,92,2,117,93], [6,58,36,2,59,37], [4,46,20,6,47,21], [7,42,14,4,43,15],
  [4,133,107], [8,59,37,1,60,38], [8,44,20,4,45,21], [12,33,11,4,34,12],
  [3,145,115,1,146,116], [4,64,40,5,65,41], [11,36,16,5,37,17], [11,36,12,5,37,13],
  [5,109,87,1,110,88], [5,65,41,5,66,42], [5,54,24,7,55,25], [11,36,12,7,37,13], // v11-v15
  [5,122,98,1,123,99], [7,73,45,3,74,46], [15,43,19,2,44,20], [3,45,15,13,46,16],
  [1,135,107,5,136,108], [10,74,46,1,75,47], [1,50,22,15,51,23], [2,42,14,17,43,15],
  [5,150,120,1,151,121], [9,69,43,4,70,44], [17,50,22,1,51,23], [2,42,14,19,43,15],
  [3,141,113,4,142,114], [3,70,44,11,71,45], [17,47,21,4,48,22], [9,39,13,16,40,14],
  [3,135,107,5,136,108], [3,67,41,13,68,42], [15,54,24,5,55,25], [15,43,15,10,44,16], // v16-v20
  [4,144,116,4,145,117], [17,68,42], [17,50,22,6,51,23], [19,46,16,6,47,17],
  [2,139,111,7,140,112], [17,74,46], [7,54,24,16,55,25], [34,37,13],
  [4,151,121,5,152,122], [4,75,47,14,76,48], [11,54,24,14,55,25], [16,45,15,14,46,16],
  [6,147,117,4,148,118], [6,73,45,14,74,46], [11,54,24,16,55,25], [30,46,16,2,47,17],
  [8,132,106,4,133,107], [8,75,47,13,76,48], [7,54,24,22,55,25], [22,45,15,13,46,16], // v21-v25
  [10,142,114,2,143,115], [19,74,46,4,75,47], [28,50,22,6,51,23], [33,46,16,4,47,17],
  [8,152,122,4,153,123], [22,73,45,3,74,46], [8,53,23,26,54,24], [12,45,15,28,46,16],
  [3,147,117,10,148,118], [3,73,45,23,74,46], [4,54,24,31,55,25], [11,45,15,31,46,16],
  [7,146,116,7,147,117], [21,73,45,7,74,46], [1,53,23,37,54,24], [19,45,15,26,46,16],
  [5,145,115,10,146,116], [19,75,47,10,76,48], [15,54,24,25,55,25], [23,45,15,25,46,16], // v26-v30
  [13,145,115,3,146,116], [2,74,46,29,75,47], [42,54,24,1,55,25], [23,45,15,28,46,16],
  [17,145,115], [10,74,46,23,75,47], [10,54,24,35,55,25], [19,45,15,35,46,16],
  [17,145,115,1,146,116], [14,74,46,21,75,47], [29,54,24,19,55,25], [11,45,15,46,46,16],
  [13,145,115,6,146,116], [14,74,46,23,75,47], [44,54,24,7,55,25], [59,46,16,1,47,17],
  [12,151,121,7,152,122], [12,75,47,26,76,48], [39,54,24,14,55,25], [22,45,15,41,46,16], // v31-v35
  [6,151,121,14,152,122], [6,75,47,34,76,48], [46,54,24,10,55,25], [2,45,15,64,46,16],
  [17,152,122,4,153,123], [29,74,46,14,75,47], [49,54,24,10,55,25], [24,45,15,46,46,16],
  [4,152,122,18,153,123], [13,74,46,32,75,47], [48,54,24,14,55,25], [42,45,15,32,46,16],
  [20,147,117,4,148,118], [40,75,47,7,76,48], [43,54,24,22,55,25], [10,45,15,67,46,16],
  [19,148,118,6,149,119], [18,75,47,31,76,48], [34,54,24,34,55,25], [20,45,15,61,46,16], // v36-v40
];

const LEVEL_INDEX = { L: 0, M: 1, Q: 2, H: 3 };
// Indicatore di livello nei format info (2 bit): L=01, M=00, Q=11, H=10.
const FORMAT_LEVEL = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' };

export function refBlocks(typeNumber, eccLabel) {
  const row = RS_REF[(typeNumber - 1) * 4 + LEVEL_INDEX[eccLabel]];
  const blocks = [];
  for (let i = 0; i < row.length; i += 3) {
    for (let j = 0; j < row[i]; j++) blocks.push({ total: row[i + 1], data: row[i + 2] });
  }
  return blocks;
}

const PAT = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]];

function getMask(m, i, j) {
  switch (m) {
    case 0: return (i + j) % 2 === 0;
    case 1: return i % 2 === 0;
    case 2: return j % 3 === 0;
    case 3: return (i + j) % 3 === 0;
    case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5: return (i * j) % 2 + (i * j) % 3 === 0;
    case 6: return ((i * j) % 2 + (i * j) % 3) % 2 === 0;
    case 7: return ((i * j) % 3 + (i + j) % 2) % 2 === 0;
    default: return false;
  }
}

function expectBytes(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c < 0x80) { out.push(c); continue; }
    if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); continue; }
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
      const c2 = text.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 < 0xe000) {
        i++;
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        continue;
      }
    }
    out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

// ---- GF(256) con polinomio 0x11d (quello dei QR) per il check delle sindromi ----
const GF_EXP = new Array(512);
const GF_LOG = new Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x; GF_LOG[x] = i;
    x <<= 1; if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}
function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]; }

// Sindromi RS: il codeword c[0..n-1] (c[0] = coefficiente di grado più alto)
// è valido sse S_i = C(alpha^i) = 0 per i = 0..ecLen-1.
function rsSyndromesZero(codeword, ecLen) {
  for (let i = 0; i < ecLen; i++) {
    let s = 0;
    const a = GF_EXP[i % 255];
    for (let j = 0; j < codeword.length; j++) s = gfMul(s, a) ^ codeword[j];
    if (s !== 0) return false;
  }
  return true;
}

// Ritorna { ok, mode, len, got, exp, typeNumber, formatLevel, rsOk }.
// ok = true SOLO se: livello dichiarato = livello richiesto, parità RS coerente
// su TUTTI i blocchi, e byte dati identici all'UTF-8 dell'input.
export function roundTrip(text, ecc = 'M') {
  const qr = SN_QR.create(text, ecc);
  const n = qr.getModuleCount();
  const isDark = (r, c) => qr.isDark(r, c);

  // format info → livello ECC dichiarato + mask pattern
  let fmt = 0;
  for (let i = 0; i < 15; i++) {
    let r;
    if (i < 6) r = i; else if (i < 8) r = i + 1; else r = n - 15 + i;
    if (isDark(r, 8)) fmt |= (1 << i);
  }
  fmt ^= ((1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1)); // G15_MASK
  const maskPattern = (fmt >> 10) & 7;
  const formatLevel = FORMAT_LEVEL[(fmt >> 13) & 3];

  // mappa dei moduli funzionali (riservati)
  const reserved = Array.from({ length: n }, () => new Array(n).fill(false));
  const mark = (r, c) => { if (r >= 0 && r < n && c >= 0 && c < n) reserved[r][c] = true; };
  const probe = (row, col) => { for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) mark(row + r, col + c); };
  probe(0, 0); probe(n - 7, 0); probe(0, n - 7);
  for (let i = 0; i < n; i++) { mark(6, i); mark(i, 6); }
  const typeNumber = (n - 17) / 4;
  const pos = PAT[typeNumber - 1];
  const onFinder = (row, col) => (
    (row <= 6 && col <= 6) || (row <= 6 && col >= n - 7) || (row >= n - 7 && col <= 6)
  );
  for (const r of pos) for (const c of pos) {
    if (onFinder(r, c)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(r + dr, c + dc);
  }
  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(8, n - 1 - i); mark(n - 1 - i, 8); }
  mark(n - 8, 8);
  if (typeNumber >= 7) {
    for (let i = 0; i < 18; i++) {
      mark(Math.floor(i / 3), i % 3 + n - 8 - 3);
      mark(i % 3 + n - 8 - 3, Math.floor(i / 3));
    }
  }

  // estrai i codeword (con demask) nello stesso zig-zag dell'encoder
  const bytes = [];
  let cur = 0, bits = 0, inc = -1, row = n - 1;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (!reserved[row][cc]) {
          let dark = isDark(row, cc);
          if (getMask(maskPattern, row, cc)) dark = !dark;
          cur = (cur << 1) | (dark ? 1 : 0);
          if (++bits === 8) { bytes.push(cur); cur = 0; bits = 0; }
        }
      }
      row += inc;
      if (row < 0 || row >= n) { row -= inc; inc = -inc; break; }
    }
  }

  // de-interleaving secondo la struttura a blocchi DELLO STANDARD per
  // (versione, livello richiesto) + verifica parità RS blocco per blocco
  const blocks = refBlocks(typeNumber, ecc);
  const ecLen = blocks[0].total - blocks[0].data; // uguale per tutti i blocchi
  const maxData = Math.max(...blocks.map((b) => b.data));
  const dataArr = blocks.map(() => []);
  const ecArr = blocks.map(() => []);
  let p = 0;
  for (let i = 0; i < maxData; i++) {
    for (let b = 0; b < blocks.length; b++) if (i < blocks[b].data) dataArr[b].push(bytes[p++]);
  }
  for (let i = 0; i < ecLen; i++) {
    for (let b = 0; b < blocks.length; b++) ecArr[b].push(bytes[p++]);
  }
  let rsOk = p <= bytes.length;
  for (let b = 0; rsOk && b < blocks.length; b++) {
    rsOk = rsSyndromesZero(dataArr[b].concat(ecArr[b]), ecLen);
  }

  // bitstream dati = blocchi dati concatenati in ordine
  let bitstr = '';
  for (const arr of dataArr) for (const b of arr) bitstr += b.toString(2).padStart(8, '0');
  const mode = parseInt(bitstr.slice(0, 4), 2);
  const lenBits = typeNumber < 10 ? 8 : 16;
  const len = parseInt(bitstr.slice(4, 4 + lenBits), 2);
  const got = [];
  for (let i = 0; i < len; i++) got.push(parseInt(bitstr.slice(4 + lenBits + i * 8, 4 + lenBits + i * 8 + 8), 2));
  const exp = expectBytes(text);
  const ok = formatLevel === ecc && rsOk && mode === 4 && len === exp.length && got.join(',') === exp.join(',');
  return { ok, mode, len, got, exp, typeNumber, formatLevel, rsOk };
}

export { SN_QR };
