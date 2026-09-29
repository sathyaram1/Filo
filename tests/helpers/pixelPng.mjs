// Pixel RGBA di un PNG a 8 bit (RGB o RGBA, non interlacciato): quanto basta alle prove del marchio invisibile.
// Nei test senza Electron non c'è un decoder d'immagini; qui non si gestisce altro che quei PNG.
import zlib from 'node:zlib';
export function decodificaPng(buf) {
  let i = 8, w = 0, h = 0, tipo = 0; const idat = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i); const t = buf.toString('latin1', i + 4, i + 8); const d = buf.subarray(i + 8, i + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); tipo = d[9]; if (d[8] !== 8 || d[12]) throw new Error('png non gestito'); }
    if (t === 'IDAT') idat.push(d);
    if (t === 'IEND') break;
    i += 12 + len;
  }
  const bpp = tipo === 6 ? 4 : tipo === 2 ? 3 : (() => { throw new Error('tipo ' + tipo); })();
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp; const out = Buffer.alloc(w * h * 4); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const riga = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? riga[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      riga[x] = (riga[x] + p) & 255;
    }
    for (let x = 0; x < w; x++) { out[(y * w + x) * 4] = riga[x * bpp]; out[(y * w + x) * 4 + 1] = riga[x * bpp + 1]; out[(y * w + x) * 4 + 2] = riga[x * bpp + 2]; out[(y * w + x) * 4 + 3] = bpp === 4 ? riga[x * bpp + 3] : 255; }
    prev = riga;
  }
  return { larghezza: w, altezza: h, pixel: out };
}
