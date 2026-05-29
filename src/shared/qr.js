// Generatore di QR code puro, senza dipendenze né rete.
// Port fedele dell'algoritmo "qrcode-generator" di Kazuhiko Arase (MIT /
// pubblico dominio): byte mode (UTF-8), versioni 1-40, scelta automatica
// della versione minima, mask pattern con penalty scoring.
//
// Genera tutto in locale: l'URL della pagina NON viene mai inviato a servizi
// esterni (privacy — è il QR della pagina che stai visitando).
//
// API:
//   SN_QR.toMatrix(text, { ecc })  -> boolean[][]  (true = modulo nero)
//   SN_QR.create(text, ecc)        -> { moduleCount, isDark(r,c) }
//
// `ecc` ∈ 'L' | 'M' | 'Q' | 'H' (default 'M').

(function (global) {
  'use strict';

  // ---- Galois field GF(256) ----
  const QRMath = {
    EXP_TABLE: new Array(256),
    LOG_TABLE: new Array(256),
    glog(n) { if (n < 1) throw new Error('glog(' + n + ')'); return QRMath.LOG_TABLE[n]; },
    gexp(n) { while (n < 0) n += 255; while (n >= 256) n -= 255; return QRMath.EXP_TABLE[n]; },
  };
  for (let i = 0; i < 8; i++) QRMath.EXP_TABLE[i] = 1 << i;
  for (let i = 8; i < 256; i++) {
    QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i - 4] ^ QRMath.EXP_TABLE[i - 5]
      ^ QRMath.EXP_TABLE[i - 6] ^ QRMath.EXP_TABLE[i - 8];
  }
  for (let i = 0; i < 255; i++) QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;

  // ---- Polinomi su GF(256) ----
  function QRPolynomial(num, shift) {
    if (num.length === undefined) throw new Error(num.length + '/' + shift);
    let offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    this.num = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
  }
  QRPolynomial.prototype = {
    get(i) { return this.num[i]; },
    getLength() { return this.num.length; },
    multiply(e) {
      const num = new Array(this.getLength() + e.getLength() - 1);
      for (let i = 0; i < num.length; i++) num[i] = 0;
      for (let i = 0; i < this.getLength(); i++) {
        for (let j = 0; j < e.getLength(); j++) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
        }
      }
      return new QRPolynomial(num, 0);
    },
    mod(e) {
      if (this.getLength() - e.getLength() < 0) return this;
      const ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
      const num = this.num.slice();
      for (let i = 0; i < e.getLength(); i++) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.get(i)) + ratio);
      }
      return new QRPolynomial(num, 0).mod(e);
    },
  };

  // ---- Bit buffer ----
  function QRBitBuffer() { this.buffer = []; this.length = 0; }
  QRBitBuffer.prototype = {
    get(index) { return ((this.buffer[Math.floor(index / 8)] >>> (7 - index % 8)) & 1) === 1; },
    put(num, length) {
      for (let i = 0; i < length; i++) this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    },
    getLengthInBits() { return this.length; },
    putBit(bit) {
      const bufIndex = Math.floor(this.length / 8);
      if (this.buffer.length <= bufIndex) this.buffer.push(0);
      if (bit) this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
      this.length++;
    },
  };

  // ---- Dato in byte mode (UTF-8) ----
  function utf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        // surrogate pair
        const c2 = str.charCodeAt(++i);
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }
    return out;
  }
  function QR8bitByte(data) { this.mode = 4; this.data = data; this.bytes = utf8Bytes(data); }
  QR8bitByte.prototype = {
    getLength() { return this.bytes.length; },
    write(buffer) { for (let i = 0; i < this.bytes.length; i++) buffer.put(this.bytes[i], 8); },
  };

  // ---- Tabelle ----
  const ECC = { L: 1, M: 0, Q: 3, H: 2 }; // codifica QR del livello
  const PATTERN_POSITION_TABLE = [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42],
    [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66],
    [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
    [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170],
  ];
  const G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
  const G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
  const G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

  const QRUtil = {
    getBCHDigit(data) { let digit = 0; while (data !== 0) { digit++; data >>>= 1; } return digit; },
    getBCHTypeInfo(data) {
      let d = data << 10;
      while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(G15) >= 0) {
        d ^= (G15 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(G15)));
      }
      return ((data << 10) | d) ^ G15_MASK;
    },
    getBCHTypeNumber(data) {
      let d = data << 12;
      while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(G18) >= 0) {
        d ^= (G18 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(G18)));
      }
      return (data << 12) | d;
    },
    getPatternPosition(typeNumber) { return PATTERN_POSITION_TABLE[typeNumber - 1]; },
    getMask(maskPattern, i, j) {
      switch (maskPattern) {
        case 0: return (i + j) % 2 === 0;
        case 1: return i % 2 === 0;
        case 2: return j % 3 === 0;
        case 3: return (i + j) % 3 === 0;
        case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case 5: return (i * j) % 2 + (i * j) % 3 === 0;
        case 6: return ((i * j) % 2 + (i * j) % 3) % 2 === 0;
        case 7: return ((i * j) % 3 + (i + j) % 2) % 2 === 0;
        default: throw new Error('bad maskPattern:' + maskPattern);
      }
    },
    getErrorCorrectPolynomial(errorCorrectLength) {
      let a = new QRPolynomial([1], 0);
      for (let i = 0; i < errorCorrectLength; i++) {
        a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
      }
      return a;
    },
    getLengthInBits(mode, type) {
      if (type >= 1 && type < 10) {
        // byte mode -> 8
        return 8;
      } else if (type < 27) {
        return 16;
      } else if (type < 41) {
        return 16;
      }
      throw new Error('type:' + type);
    },
    getLostPoint(qrcode) {
      const moduleCount = qrcode.getModuleCount();
      let lostPoint = 0;
      // LEVEL1
      for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
          let sameCount = 0;
          const dark = qrcode.isDark(row, col);
          for (let r = -1; r <= 1; r++) {
            if (row + r < 0 || moduleCount <= row + r) continue;
            for (let c = -1; c <= 1; c++) {
              if (col + c < 0 || moduleCount <= col + c) continue;
              if (r === 0 && c === 0) continue;
              if (dark === qrcode.isDark(row + r, col + c)) sameCount++;
            }
          }
          if (sameCount > 5) lostPoint += (3 + sameCount - 5);
        }
      }
      // LEVEL2
      for (let row = 0; row < moduleCount - 1; row++) {
        for (let col = 0; col < moduleCount - 1; col++) {
          let count = 0;
          if (qrcode.isDark(row, col)) count++;
          if (qrcode.isDark(row + 1, col)) count++;
          if (qrcode.isDark(row, col + 1)) count++;
          if (qrcode.isDark(row + 1, col + 1)) count++;
          if (count === 0 || count === 4) lostPoint += 3;
        }
      }
      // LEVEL3
      for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount - 6; col++) {
          if (qrcode.isDark(row, col) && !qrcode.isDark(row, col + 1)
            && qrcode.isDark(row, col + 2) && qrcode.isDark(row, col + 3)
            && qrcode.isDark(row, col + 4) && !qrcode.isDark(row, col + 5)
            && qrcode.isDark(row, col + 6)) lostPoint += 40;
        }
      }
      for (let col = 0; col < moduleCount; col++) {
        for (let row = 0; row < moduleCount - 6; row++) {
          if (qrcode.isDark(row, col) && !qrcode.isDark(row + 1, col)
            && qrcode.isDark(row + 2, col) && qrcode.isDark(row + 3, col)
            && qrcode.isDark(row + 4, col) && !qrcode.isDark(row + 5, col)
            && qrcode.isDark(row + 6, col)) lostPoint += 40;
        }
      }
      // LEVEL4
      let darkCount = 0;
      for (let col = 0; col < moduleCount; col++) {
        for (let row = 0; row < moduleCount; row++) {
          if (qrcode.isDark(row, col)) darkCount++;
        }
      }
      const ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;
      return lostPoint;
    },
  };

  // ---- RS block table (versioni 1-40, livelli L/M/Q/H) ----
  // Indici per livello: M=0, L=1, H=2, Q=3 (come l'originale).
  const RS_BLOCK_TABLE = [
    [1, 26, 19], [1, 26, 16], [1, 26, 9], [1, 26, 13],
    [1, 44, 34], [1, 44, 28], [1, 44, 16], [1, 44, 22],
    [1, 70, 55], [1, 70, 44], [2, 35, 13], [2, 35, 17],
    [1, 100, 80], [2, 50, 32], [4, 25, 9], [2, 50, 24],
    [1, 134, 108], [2, 67, 43], [2, 33, 11, 2, 34, 12], [2, 33, 15, 2, 34, 16],
    [2, 86, 68], [4, 43, 27], [4, 43, 15], [4, 43, 19],
    [2, 98, 78], [4, 49, 31], [4, 39, 13, 1, 40, 14], [2, 32, 14, 4, 33, 15],
    [2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 14, 2, 41, 15], [4, 40, 18, 2, 41, 19],
    [2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 12, 4, 37, 13], [4, 36, 16, 4, 37, 17],
    [2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 15, 2, 44, 16], [6, 43, 19, 2, 44, 20],
    [4, 101, 81], [1, 80, 50, 4, 81, 51], [4, 50, 22, 4, 51, 23], [3, 36, 12, 8, 37, 13],
    [2, 116, 92, 2, 117, 93], [6, 58, 36, 2, 59, 37], [4, 46, 20, 6, 47, 21], [7, 42, 14, 4, 43, 15],
    [4, 133, 107], [8, 59, 37, 1, 60, 38], [8, 44, 20, 4, 45, 21], [12, 33, 11, 4, 34, 12],
    [3, 145, 115, 1, 146, 116], [4, 64, 40, 5, 65, 41], [11, 36, 16, 5, 37, 17], [11, 36, 12, 5, 37, 13],
    [5, 109, 87, 1, 110, 88], [5, 65, 41, 5, 66, 42], [5, 54, 24, 7, 55, 25], [11, 36, 12, 7, 37, 13],
    [5, 122, 98, 1, 123, 99], [7, 73, 45, 3, 74, 46], [15, 43, 19, 2, 44, 20], [3, 45, 15, 13, 46, 16],
    [1, 135, 107, 5, 136, 108], [10, 74, 46, 1, 75, 47], [1, 50, 22, 15, 51, 23], [2, 42, 14, 17, 43, 15],
    [5, 150, 120, 1, 151, 121], [9, 69, 43, 4, 70, 44], [17, 50, 22, 1, 51, 23], [2, 42, 14, 19, 43, 15],
    [3, 141, 113, 4, 142, 114], [3, 70, 44, 11, 71, 45], [17, 47, 21, 4, 48, 22], [9, 39, 13, 16, 40, 14],
    [3, 135, 107, 5, 136, 108], [3, 67, 41, 13, 68, 42], [15, 54, 24, 5, 55, 25], [15, 43, 15, 10, 44, 16],
    [4, 144, 116, 4, 145, 117], [17, 68, 42], [17, 50, 22, 6, 51, 23], [19, 46, 16, 6, 47, 17],
    [2, 139, 111, 7, 140, 112], [17, 74, 46], [7, 54, 24, 16, 55, 25], [34, 37, 13],
    [4, 151, 121, 5, 152, 122], [4, 75, 47, 14, 76, 48], [11, 54, 24, 14, 55, 25], [16, 45, 15, 14, 46, 16],
    [6, 147, 117, 4, 148, 118], [6, 73, 45, 14, 74, 46], [11, 54, 24, 16, 55, 25], [30, 46, 16, 2, 47, 17],
    [8, 132, 106, 4, 133, 107], [8, 75, 47, 13, 76, 48], [7, 54, 24, 22, 55, 25], [22, 45, 15, 13, 46, 16],
    [10, 142, 114, 2, 143, 115], [19, 74, 46, 4, 75, 47], [28, 50, 22, 6, 51, 23], [33, 46, 16, 4, 47, 17],
    [8, 152, 122, 4, 153, 123], [22, 73, 45, 3, 74, 46], [8, 53, 23, 26, 54, 24], [12, 45, 15, 28, 46, 16],
    [3, 147, 117, 10, 148, 118], [3, 73, 45, 23, 74, 46], [4, 54, 24, 31, 55, 25], [11, 45, 15, 31, 46, 16],
    [7, 146, 116, 7, 147, 117], [21, 73, 45, 7, 74, 46], [1, 53, 23, 37, 54, 24], [19, 45, 15, 26, 46, 16],
    [5, 145, 115, 10, 146, 116], [19, 75, 47, 10, 76, 48], [15, 54, 24, 25, 55, 25], [23, 45, 15, 25, 46, 16],
    [13, 145, 115, 3, 146, 116], [2, 74, 46, 29, 75, 47], [42, 54, 24, 1, 55, 25], [23, 45, 15, 28, 46, 16],
    [17, 145, 115], [10, 74, 46, 23, 75, 47], [10, 54, 24, 35, 55, 25], [19, 45, 15, 35, 46, 16],
    [17, 145, 115, 1, 146, 116], [14, 74, 46, 21, 75, 47], [29, 54, 24, 19, 55, 25], [11, 45, 15, 46, 46, 16],
    [13, 145, 115, 6, 146, 116], [14, 74, 46, 23, 75, 47], [44, 54, 24, 7, 55, 25], [59, 46, 16, 1, 47, 17],
    [12, 151, 121, 7, 152, 122], [12, 75, 47, 26, 76, 48], [39, 54, 24, 14, 55, 25], [22, 45, 15, 41, 46, 16],
    [6, 151, 121, 14, 152, 122], [6, 75, 47, 34, 76, 48], [46, 54, 24, 10, 55, 25], [2, 45, 15, 64, 46, 16],
    [17, 152, 122, 4, 153, 123], [29, 74, 46, 14, 75, 47], [49, 54, 24, 10, 55, 25], [24, 45, 15, 46, 46, 16],
    [4, 152, 122, 18, 153, 123], [13, 74, 46, 32, 75, 47], [48, 54, 24, 14, 55, 25], [42, 45, 15, 32, 46, 16],
    [20, 147, 117, 4, 148, 118], [40, 75, 47, 7, 76, 48], [43, 54, 24, 22, 55, 25], [10, 45, 15, 67, 46, 16],
    [19, 148, 118, 6, 149, 119], [18, 75, 47, 31, 76, 48], [34, 54, 24, 34, 55, 25], [20, 45, 15, 61, 46, 16],
  ];

  function QRRSBlock(totalCount, dataCount) { this.totalCount = totalCount; this.dataCount = dataCount; }
  QRRSBlock.getRSBlocks = function (typeNumber, errorCorrectLevel) {
    const rsBlock = RS_BLOCK_TABLE[(typeNumber - 1) * 4 + errorCorrectLevel];
    if (rsBlock === undefined) {
      throw new Error('bad rs block @ type:' + typeNumber + '/ecc:' + errorCorrectLevel);
    }
    const length = rsBlock.length / 3;
    const list = [];
    for (let i = 0; i < length; i++) {
      const count = rsBlock[i * 3 + 0];
      const totalCount = rsBlock[i * 3 + 1];
      const dataCount = rsBlock[i * 3 + 2];
      for (let j = 0; j < count; j++) list.push(new QRRSBlock(totalCount, dataCount));
    }
    return list;
  };

  // ---- QRCode ----
  function QRCodeModel(typeNumber, errorCorrectLevel) {
    this.typeNumber = typeNumber;
    this.errorCorrectLevel = errorCorrectLevel;
    this.modules = null;
    this.moduleCount = 0;
    this.dataCache = null;
    this.dataList = [];
  }
  QRCodeModel.prototype = {
    addData(data) { this.dataList.push(new QR8bitByte(data)); this.dataCache = null; },
    isDark(row, col) {
      if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
        throw new Error(row + ',' + col);
      }
      return this.modules[row][col];
    },
    getModuleCount() { return this.moduleCount; },
    make() { this.makeImpl(false, this.getBestMaskPattern()); },
    makeImpl(test, maskPattern) {
      this.moduleCount = this.typeNumber * 4 + 17;
      this.modules = new Array(this.moduleCount);
      for (let row = 0; row < this.moduleCount; row++) {
        this.modules[row] = new Array(this.moduleCount);
        for (let col = 0; col < this.moduleCount; col++) this.modules[row][col] = null;
      }
      this.setupPositionProbePattern(0, 0);
      this.setupPositionProbePattern(this.moduleCount - 7, 0);
      this.setupPositionProbePattern(0, this.moduleCount - 7);
      this.setupPositionAdjustPattern();
      this.setupTimingPattern();
      this.setupTypeInfo(test, maskPattern);
      if (this.typeNumber >= 7) this.setupTypeNumber(test);
      if (this.dataCache === null) {
        this.dataCache = QRCodeModel.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
      }
      this.mapData(this.dataCache, maskPattern);
    },
    setupPositionProbePattern(row, col) {
      for (let r = -1; r <= 7; r++) {
        if (row + r <= -1 || this.moduleCount <= row + r) continue;
        for (let c = -1; c <= 7; c++) {
          if (col + c <= -1 || this.moduleCount <= col + c) continue;
          this.modules[row + r][col + c] = (r >= 0 && r <= 6 && (c === 0 || c === 6))
            || (c >= 0 && c <= 6 && (r === 0 || r === 6))
            || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        }
      }
    },
    getBestMaskPattern() {
      let minLostPoint = 0; let pattern = 0;
      for (let i = 0; i < 8; i++) {
        this.makeImpl(true, i);
        const lostPoint = QRUtil.getLostPoint(this);
        if (i === 0 || minLostPoint > lostPoint) { minLostPoint = lostPoint; pattern = i; }
      }
      return pattern;
    },
    setupTimingPattern() {
      for (let r = 8; r < this.moduleCount - 8; r++) {
        if (this.modules[r][6] !== null) continue;
        this.modules[r][6] = (r % 2 === 0);
      }
      for (let c = 8; c < this.moduleCount - 8; c++) {
        if (this.modules[6][c] !== null) continue;
        this.modules[6][c] = (c % 2 === 0);
      }
    },
    setupPositionAdjustPattern() {
      const pos = QRUtil.getPatternPosition(this.typeNumber);
      for (let i = 0; i < pos.length; i++) {
        for (let j = 0; j < pos.length; j++) {
          const row = pos[i]; const col = pos[j];
          if (this.modules[row][col] !== null) continue;
          for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
              this.modules[row + r][col + c] = (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0));
            }
          }
        }
      }
    },
    setupTypeNumber(test) {
      const bits = QRUtil.getBCHTypeNumber(this.typeNumber);
      for (let i = 0; i < 18; i++) {
        const mod = (!test && ((bits >> i) & 1) === 1);
        this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
      }
      for (let i = 0; i < 18; i++) {
        const mod = (!test && ((bits >> i) & 1) === 1);
        this.modules[i % 3 + this.moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    },
    setupTypeInfo(test, maskPattern) {
      const data = (this.errorCorrectLevel << 3) | maskPattern;
      const bits = QRUtil.getBCHTypeInfo(data);
      // vertical
      for (let i = 0; i < 15; i++) {
        const mod = (!test && ((bits >> i) & 1) === 1);
        if (i < 6) this.modules[i][8] = mod;
        else if (i < 8) this.modules[i + 1][8] = mod;
        else this.modules[this.moduleCount - 15 + i][8] = mod;
      }
      // horizontal
      for (let i = 0; i < 15; i++) {
        const mod = (!test && ((bits >> i) & 1) === 1);
        if (i < 8) this.modules[8][this.moduleCount - i - 1] = mod;
        else if (i < 9) this.modules[8][15 - i - 1 + 1] = mod;
        else this.modules[8][15 - i - 1] = mod;
      }
      this.modules[this.moduleCount - 8][8] = !test;
    },
    mapData(data, maskPattern) {
      let inc = -1; let row = this.moduleCount - 1; let bitIndex = 7; let byteIndex = 0;
      for (let col = this.moduleCount - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        for (;;) {
          for (let c = 0; c < 2; c++) {
            if (this.modules[row][col - c] === null) {
              let dark = false;
              if (byteIndex < data.length) dark = (((data[byteIndex] >>> bitIndex) & 1) === 1);
              const mask = QRUtil.getMask(maskPattern, row, col - c);
              if (mask) dark = !dark;
              this.modules[row][col - c] = dark;
              bitIndex--;
              if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
            }
          }
          row += inc;
          if (row < 0 || this.moduleCount <= row) { row -= inc; inc = -inc; break; }
        }
      }
    },
  };
  const PAD0 = 0xEC; const PAD1 = 0x11;
  QRCodeModel.createData = function (typeNumber, errorCorrectLevel, dataList) {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
    const buffer = new QRBitBuffer();
    for (let i = 0; i < dataList.length; i++) {
      const data = dataList[i];
      buffer.put(data.mode, 4);
      buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber));
      data.write(buffer);
    }
    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;
    if (buffer.getLengthInBits() > totalDataCount * 8) {
      throw new Error('code length overflow. (' + buffer.getLengthInBits() + '>' + totalDataCount * 8 + ')');
    }
    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
    while (buffer.getLengthInBits() % 8 !== 0) buffer.putBit(false);
    for (;;) {
      if (buffer.getLengthInBits() >= totalDataCount * 8) break;
      buffer.put(PAD0, 8);
      if (buffer.getLengthInBits() >= totalDataCount * 8) break;
      buffer.put(PAD1, 8);
    }
    return QRCodeModel.createBytes(buffer, rsBlocks);
  };
  QRCodeModel.createBytes = function (buffer, rsBlocks) {
    let offset = 0; let maxDcCount = 0; let maxEcCount = 0;
    const dcdata = new Array(rsBlocks.length);
    const ecdata = new Array(rsBlocks.length);
    for (let r = 0; r < rsBlocks.length; r++) {
      const dcCount = rsBlocks[r].dataCount;
      const ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);
      dcdata[r] = new Array(dcCount);
      for (let i = 0; i < dcdata[r].length; i++) dcdata[r][i] = 0xff & buffer.buffer[i + offset];
      offset += dcCount;
      const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
      const rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.getLength() - 1);
      for (let i = 0; i < ecdata[r].length; i++) {
        const modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = (modIndex >= 0) ? modPoly.get(modIndex) : 0;
      }
    }
    let totalCodeCount = 0;
    for (let i = 0; i < rsBlocks.length; i++) totalCodeCount += rsBlocks[i].totalCount;
    const data = new Array(totalCodeCount);
    let index = 0;
    for (let i = 0; i < maxDcCount; i++) {
      for (let r = 0; r < rsBlocks.length; r++) {
        if (i < dcdata[r].length) data[index++] = dcdata[r][i];
      }
    }
    for (let i = 0; i < maxEcCount; i++) {
      for (let r = 0; r < rsBlocks.length; r++) {
        if (i < ecdata[r].length) data[index++] = ecdata[r][i];
      }
    }
    return data;
  };

  // Capienza in byte (byte mode) per ogni versione/livello. Calcolata dai
  // dataCount dei blocchi RS meno l'overhead di header (4 bit mode + length).
  function byteCapacity(typeNumber, eccLevel) {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, eccLevel);
    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;
    const lengthBits = QRUtil.getLengthInBits(4, typeNumber);
    // bit disponibili - 4 (mode) - lengthBits, in byte (floor)
    return Math.floor((totalDataCount * 8 - 4 - lengthBits) / 8);
  }

  // ---- API pubblica ----
  function create(text, eccLabel) {
    const level = ECC[eccLabel] !== undefined ? ECC[eccLabel] : ECC.M;
    const bytes = utf8Bytes(String(text == null ? '' : text)).length;
    let typeNumber = 1;
    while (typeNumber <= 40) {
      if (byteCapacity(typeNumber, level) >= bytes) break;
      typeNumber++;
    }
    if (typeNumber > 40) throw new Error('dati troppo lunghi per un QR code');
    const qr = new QRCodeModel(typeNumber, level);
    qr.addData(String(text == null ? '' : text));
    qr.make();
    return qr;
  }

  function toMatrix(text, opts = {}) {
    const qr = create(text, opts.ecc || 'M');
    const n = qr.getModuleCount();
    const out = new Array(n);
    for (let r = 0; r < n; r++) {
      out[r] = new Array(n);
      for (let c = 0; c < n; c++) out[r][c] = qr.isDark(r, c);
    }
    return out;
  }

  global.SN_QR = { create, toMatrix };
})(typeof globalThis !== 'undefined' ? globalThis : self);
