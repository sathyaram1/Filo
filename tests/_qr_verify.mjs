// Verifica decodifica round-trip del generatore QR: rigenera la bitstream dei
// dati dalla matrice e controlla che corrisponda all'input UTF-8.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('../src/shared/qr.js');
const SN_QR = globalThis.SN_QR;

const RS_TABLE_LEN = { /* recompute via getRSBlocks not exported; replicate minimal */ };

// Decoder minimale (solo data codewords, niente correzione RS): valida
// encoding + mask + placement + interleaving.
function decode(text, ecc = 'M') {
  const qr = SN_QR.create(text, ecc);
  const n = qr.getModuleCount();
  const isDark = (r, c) => qr.isDark(r, c);

  // --- leggi format info (strip verticale) per ricavare il mask pattern ---
  const fmtBit = (i) => {
    let r;
    if (i < 6) r = i; else if (i < 8) r = i + 1; else r = n - 15 + i;
    return isDark(r, 8) ? 1 : 0;
  };
  let fmt = 0;
  for (let i = 0; i < 15; i++) fmt |= (fmtBit(i) << i);
  fmt ^= ((1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1)); // G15_MASK
  const data5 = fmt >> 10;
  const maskPattern = data5 & 7;

  const getMask = (m, i, j) => {
    switch (m) {
      case 0: return (i + j) % 2 === 0;
      case 1: return i % 2 === 0;
      case 2: return j % 3 === 0;
      case 3: return (i + j) % 3 === 0;
      case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
      case 5: return (i * j) % 2 + (i * j) % 3 === 0;
      case 6: return ((i * j) % 2 + (i * j) % 3) % 2 === 0;
      case 7: return ((i * j) % 3 + (i + j) % 2) % 2 === 0;
    }
  };

  // ricostruisci la mappa "funzionale" (moduli riservati) ripetendo il setup
  const reserved = Array.from({ length: n }, () => new Array(n).fill(false));
  const mark = (r, c) => { if (r >= 0 && r < n && c >= 0 && c < n) reserved[r][c] = true; };
  const probe = (row, col) => { for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) mark(row + r, col + c); };
  probe(0, 0); probe(n - 7, 0); probe(0, n - 7);
  // timing
  for (let i = 0; i < n; i++) { mark(6, i); mark(i, 6); }
  // alignment
  const typeNumber = (n - 17) / 4;
  const PAT = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]];
  const pos = PAT[typeNumber - 1];
  const probeOnFinder = (row, col) => (
    (row <= 6 && col <= 6) || (row <= 6 && col >= n - 7) || (row >= n - 7 && col <= 6)
  );
  for (const r of pos) for (const c of pos) {
    if (probeOnFinder(r, c)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(r + dr, c + dc);
  }
  // format info aree
  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(8, n - 1 - i); mark(n - 1 - i, 8); }
  mark(n - 8, 8);
  // version info (typeNumber>=7)
  if (typeNumber >= 7) {
    for (let i = 0; i < 18; i++) {
      mark(Math.floor(i / 3), i % 3 + n - 8 - 3);
      mark(i % 3 + n - 8 - 3, Math.floor(i / 3));
    }
  }

  // --- estrai bitstream dei codeword (con demask) ---
  const bytes = [];
  let cur = 0, bits = 0;
  let inc = -1, row = n - 1;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (!reserved[row][cc]) {
          let dark = isDark(row, cc);
          if (getMask(maskPattern, row, cc)) dark = !dark;
          cur = (cur << 1) | (dark ? 1 : 0);
          bits++;
          if (bits === 8) { bytes.push(cur); cur = 0; bits = 0; }
        }
      }
      row += inc;
      if (row < 0 || row >= n) { row -= inc; inc = -inc; break; }
    }
  }
  return { bytes, typeNumber, maskPattern };
}

// Per de-interleavare servono i blocchi RS; replico la tabella tramite la
// stessa logica del modulo non esportata. Più semplice: per versioni piccole
// (1 blocco) i data codeword sono i primi dataCount byte in ordine.
// Uso input che restano in 1 blocco RS (versioni <= ~5 con ECC M).
function expectBytes(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

let pass = 0, fail = 0;
function check(text) {
  const { bytes, typeNumber } = decode(text, 'M');
  const exp = expectBytes(text);
  // header: 4 bit mode (0100) + 8 o 16 bit length
  // ricostruisco la bitstream dai bytes per leggere mode+length+payload
  let bitstr = '';
  for (const b of bytes) bitstr += b.toString(2).padStart(8, '0');
  const mode = parseInt(bitstr.slice(0, 4), 2);
  const lenBits = typeNumber < 10 ? 8 : 16;
  const len = parseInt(bitstr.slice(4, 4 + lenBits), 2);
  const payloadBits = bitstr.slice(4 + lenBits, 4 + lenBits + len * 8);
  const got = [];
  for (let i = 0; i < len; i++) got.push(parseInt(payloadBits.slice(i * 8, i * 8 + 8), 2));
  const ok = mode === 4 && len === exp.length && got.join(',') === exp.join(',');
  if (ok) { pass++; console.log(`OK   v${typeNumber} "${text.slice(0, 40)}" (${exp.length}B)`); }
  else {
    fail++;
    console.log(`FAIL v${typeNumber} "${text.slice(0, 40)}" mode=${mode} len=${len} exp=${exp.length}`);
    console.log('  got:', got.join(','));
    console.log('  exp:', exp.join(','));
  }
}

// Test su input che restano in 1 blocco RS (versioni 1-5, ECC M):
check('https://example.com');
check('filo://newtab/');
check('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
check('Ciao mondo àèì');
check('A');
check('https://github.com/sathyaram1/Filo');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
