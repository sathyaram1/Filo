// Generatore di QR code autonomo (nessuna dipendenza, nessun servizio esterno).
// Tutto avviene in locale: l'URL della pagina NON viene mai inviato a terzi.
//
// Port dell'algoritmo di Project Nanayuki "QR Code generator" (MIT), ridotto
// alla modalità byte (UTF-8) con selezione automatica della versione. Espone
// SN_QRCODE = { generate } dove generate(text, opts) ritorna:
//   { size, modules } con modules = matrice [size][size] di boolean (true=nero).
//
// Pattern IIFE su globalThis come gli altri moduli shared/* (vedi CLAUDE.md).

(function (global) {
  'use strict';

  // Livelli di correzione errore. ordinal usato per indicizzare le tabelle.
  const ECC = {
    LOW: { ordinal: 0, formatBits: 1 },
    MEDIUM: { ordinal: 1, formatBits: 0 },
    QUARTILE: { ordinal: 2, formatBits: 3 },
    HIGH: { ordinal: 3, formatBits: 2 },
  };

  const MIN_VERSION = 1;
  const MAX_VERSION = 40;
  const PENALTY_N1 = 3, PENALTY_N2 = 3, PENALTY_N3 = 40, PENALTY_N4 = 10;

  // ECC codewords per blocco, indicizzato [eccOrdinal][version] (version 0 = filler).
  const ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];
  const NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];

  // ---- utility a basso livello ----
  function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

  function utf8Bytes(str) {
    // Codifica UTF-8 in array di byte.
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let code = str.charCodeAt(i);
      // gestione surrogate pairs
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        const lo = str.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (lo - 0xdc00);
          i++;
        }
      }
      if (code < 0x80) out.push(code);
      else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return out;
  }

  // Numero di moduli "dati" (raw, prima di togliere ECC) per versione.
  function getNumRawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  // Numero di codeword dati disponibili per (versione, ecc).
  function getNumDataCodewords(ver, eccOrdinal) {
    return Math.floor(getNumRawDataModules(ver) / 8)
      - ECC_CODEWORDS_PER_BLOCK[eccOrdinal][ver] * NUM_ERROR_CORRECTION_BLOCKS[eccOrdinal][ver];
  }

  // ---- Reed-Solomon su GF(256) ----
  function reedSolomonComputeDivisor(degree) {
    if (degree < 1 || degree > 255) throw new RangeError('degree fuori range');
    const result = [];
    for (let i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = reedSolomonMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = reedSolomonMultiply(root, 0x02);
    }
    return result;
  }
  function reedSolomonComputeRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => { result[i] ^= reedSolomonMultiply(coef, factor); });
    }
    return result;
  }
  function reedSolomonMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  // ---- costruzione dei codeword (segmento byte) ----
  function makeDataCodewords(dataBytes, ver, eccOrdinal) {
    const bb = []; // bit buffer (array di 0/1)
    const appendBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
    };
    // Mode indicator byte = 0100
    appendBits(0x4, 4);
    // Char count: numero di byte. Larghezza dipende dalla versione.
    const ccBits = ver <= 9 ? 8 : 16;
    appendBits(dataBytes.length, ccBits);
    for (const b of dataBytes) appendBits(b, 8);

    const dataCapacityBits = getNumDataCodewords(ver, eccOrdinal) * 8;
    // Terminatore
    appendBits(0, Math.min(4, dataCapacityBits - bb.length));
    // Padding fino al byte
    appendBits(0, (8 - (bb.length % 8)) % 8);
    // Padding bytes alternati
    for (let pad = 0xec; bb.length < dataCapacityBits; pad ^= 0xec ^ 0x11) {
      appendBits(pad, 8);
    }
    // bit -> bytes
    const dataCodewords = [];
    for (let i = 0; i < bb.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bb[i + j];
      dataCodewords.push(byte);
    }
    return dataCodewords;
  }

  function addEccAndInterleave(data, ver, eccOrdinal) {
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[eccOrdinal][ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[eccOrdinal][ver];
    const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    const blocks = [];
    const rsDiv = reedSolomonComputeDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      const dat = data.slice(k, k + datLen);
      k += datLen;
      const ecc = reedSolomonComputeRemainder(dat.slice(), rsDiv);
      if (i < numShortBlocks) dat.push(0); // placeholder per allineare l'interleave
      blocks.push(dat.concat(ecc));
    }

    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        // Salta il byte placeholder dei blocchi corti nella colonna data
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
          result.push(block[i]);
        }
      });
    }
    return result;
  }

  // ---- costruzione della matrice ----
  function buildMatrix(allCodewords, ver, eccObj) {
    const size = ver * 4 + 17;
    const modules = [];
    const isFunction = [];
    for (let i = 0; i < size; i++) {
      modules.push(new Array(size).fill(false));
      isFunction.push(new Array(size).fill(false));
    }

    const setFunctionModule = (x, y, isBlack) => {
      modules[y][x] = isBlack;
      isFunction[y][x] = true;
    };

    // Timing patterns
    for (let i = 0; i < size; i++) {
      setFunctionModule(6, i, i % 2 === 0);
      setFunctionModule(i, 6, i % 2 === 0);
    }

    // Finder patterns (3 angoli) + separatori
    const drawFinder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          const xx = cx + dx, yy = cy + dy;
          if (xx >= 0 && xx < size && yy >= 0 && yy < size) {
            setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
          }
        }
      }
    };
    drawFinder(3, 3);
    drawFinder(size - 4, 3);
    drawFinder(3, size - 4);

    // Alignment patterns
    const alignPositions = getAlignmentPatternPositions(ver);
    const numAlign = alignPositions.length;
    for (let i = 0; i < numAlign; i++) {
      for (let j = 0; j < numAlign; j++) {
        // Salta i 3 angoli occupati dai finder pattern
        if ((i === 0 && j === 0) || (i === 0 && j === numAlign - 1) || (i === numAlign - 1 && j === 0)) continue;
        drawAlignment(alignPositions[i], alignPositions[j], setFunctionModule);
      }
    }

    // Riserva spazi format/version (riempiti dopo aver scelto la maschera)
    drawFormatBits(eccObj, 0, size, setFunctionModule, modules, isFunction);
    drawVersion(ver, size, setFunctionModule);

    // Disegna i codeword nei moduli non-funzione (zig-zag)
    drawCodewords(allCodewords, size, modules, isFunction);

    // Scegli la maschera migliore (penalità minima)
    let bestMask = 0;
    let minPenalty = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(mask, modules, isFunction);
      drawFormatBits(eccObj, mask, size, setFunctionModule, modules, isFunction);
      const penalty = getPenaltyScore(modules, size);
      if (penalty < minPenalty) { bestMask = mask; minPenalty = penalty; }
      applyMask(mask, modules, isFunction); // XOR inverso
    }
    applyMask(bestMask, modules, isFunction);
    drawFormatBits(eccObj, bestMask, size, setFunctionModule, modules, isFunction);

    return { size, modules };
  }

  function getAlignmentPatternPositions(ver) {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = (ver === 32) ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) {
      result.splice(1, 0, pos);
    }
    return result;
  }

  function drawAlignment(cx, cy, setFn) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  function drawFormatBits(eccObj, mask, size, setFn, modules, isFunction) {
    const data = (eccObj.formatBits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    // Prima copia (attorno al finder TL)
    for (let i = 0; i <= 5; i++) setFn(8, i, getBit(bits, i));
    setFn(8, 7, getBit(bits, 6));
    setFn(8, 8, getBit(bits, 7));
    setFn(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(bits, i));

    // Seconda copia
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(bits, i));
    setFn(8, size - 8, true); // modulo nero fisso
  }

  function drawVersion(ver, size, setFn) {
    if (ver < 7) return;
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, bit);
      setFn(b, a, bit);
    }
  }

  function drawCodewords(data, size, modules, isFunction) {
    let i = 0; // indice di bit nei dati
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // salta la colonna timing
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && i < data.length * 8) {
            modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  function applyMask(mask, modules, isFunction) {
    const size = modules.length;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isFunction[y][x]) continue;
        let invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = (x * y) % 2 + (x * y) % 3 === 0; break;
          case 6: invert = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
          case 7: invert = ((x + y) % 2 + (x * y) % 3) % 2 === 0; break;
          default: invert = false;
        }
        if (invert) modules[y][x] = !modules[y][x];
      }
    }
  }

  function getPenaltyScore(modules, size) {
    let result = 0;
    // Righe e colonne: run consecutivi >=5
    for (let y = 0; y < size; y++) {
      let runColor = false, runX = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < size; x++) {
        if (modules[y][x] === runColor) {
          runX++;
          if (runX === 5) result += PENALTY_N1;
          else if (runX > 5) result++;
        } else {
          finderPenaltyAddHistory(runX, runHistory, size);
          if (!runColor) result += finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = modules[y][x];
          runX = 1;
        }
      }
      result += finderPenaltyTerminateAndCount(runColor, runX, runHistory, size) * PENALTY_N3;
    }
    for (let x = 0; x < size; x++) {
      let runColor = false, runY = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < size; y++) {
        if (modules[y][x] === runColor) {
          runY++;
          if (runY === 5) result += PENALTY_N1;
          else if (runY > 5) result++;
        } else {
          finderPenaltyAddHistory(runY, runHistory, size);
          if (!runColor) result += finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = modules[y][x];
          runY = 1;
        }
      }
      result += finderPenaltyTerminateAndCount(runColor, runY, runHistory, size) * PENALTY_N3;
    }
    // Blocchi 2x2
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
          result += PENALTY_N2;
        }
      }
    }
    // Bilanciamento bianco/nero
    let black = 0;
    for (const row of modules) for (const c of row) if (c) black++;
    const total = size * size;
    const k = Math.ceil(Math.abs(black * 20 - total * 10) / total) - 1;
    result += k * PENALTY_N4;
    return result;
  }

  function finderPenaltyAddHistory(currentRun, runHistory, size) {
    if (runHistory[0] === 0) currentRun += size; // bordo bianco virtuale a inizio riga
    runHistory.pop();
    runHistory.unshift(currentRun);
  }
  function finderPenaltyCountPatterns(rh) {
    const n = rh[1];
    const core = n > 0 && rh[2] === n && rh[3] === n * 3 && rh[4] === n && rh[5] === n;
    return (core && rh[0] >= n * 4 && rh[6] >= n ? 1 : 0)
      + (core && rh[6] >= n * 4 && rh[0] >= n ? 1 : 0);
  }
  function finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, runHistory, size) {
    if (currentRunColor) { // run nero finale
      finderPenaltyAddHistory(currentRunLength, runHistory, size);
      currentRunLength = 0;
    }
    currentRunLength += size; // bordo bianco virtuale a fine riga
    finderPenaltyAddHistory(currentRunLength, runHistory, size);
    return finderPenaltyCountPatterns(runHistory);
  }

  // ---- API pubblica ----
  // generate(text, { ecc }) → { size, modules }.
  // ecc ∈ 'LOW'|'MEDIUM'|'QUARTILE'|'HIGH' (default MEDIUM).
  function generate(text, opts = {}) {
    const eccName = (opts.ecc || 'MEDIUM').toUpperCase();
    const eccObj = ECC[eccName] || ECC.MEDIUM;
    const dataBytes = utf8Bytes(String(text == null ? '' : text));

    // Scegli la versione minima che contiene i dati.
    let ver = MIN_VERSION;
    for (; ver <= MAX_VERSION; ver++) {
      const capacityBits = getNumDataCodewords(ver, eccObj.ordinal) * 8;
      const ccBits = ver <= 9 ? 8 : 16;
      const usedBits = 4 + ccBits + dataBytes.length * 8;
      if (usedBits <= capacityBits) break;
    }
    if (ver > MAX_VERSION) throw new Error('Testo troppo lungo per un QR code');

    const dataCodewords = makeDataCodewords(dataBytes, ver, eccObj.ordinal);
    const allCodewords = addEccAndInterleave(dataCodewords, ver, eccObj.ordinal);
    return buildMatrix(allCodewords, ver, eccObj);
  }

  global.SN_QRCODE = { generate };
})(typeof globalThis !== 'undefined' ? globalThis : self);
