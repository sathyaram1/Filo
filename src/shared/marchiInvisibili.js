// I marchi invisibili APERTI nei pixel di un'immagine: messaggi fissi che un generatore ci scrive, letti sul computer.
// Non stima niente: un marchio letto è una dichiarazione di chi l'ha messo, e la sua assenza non dice niente.
// Regole: patterns/unetichetta-di-origine-e-una-dichiarazione-non-una-prova.md

(function (global) {
  'use strict';

  function nodeMod(nome) {
    try { return (typeof require === 'function') ? require(nome) : null; } catch (_) { return null; }
  }

  function bitDiTesto(s) {
    let out = '';
    for (const c of s) out += c.charCodeAt(0).toString(2).padStart(8, '0');
    return out;
  }

  // Il metodo dwtDct di invisible-watermark (ShieldMnt, MIT) e i messaggi che il codice di riferimento di ogni
  // generatore ci scrive. FLUX passa il suo da bin()[2:], che toglie i due zeri in testa: restano 46 bit.
  const MARCHI = [
    { id: 'sdxl', chi: 'Stable Diffusion XL', bit: '101100111110110010010000011110111011000110011110' },
    { id: 'flux', chi: 'FLUX.1', bit: '1010101111111010000111100111001111010100101110' },
    { id: 'sd1', chi: 'Stable Diffusion 1', bit: bitDiTesto('StableDiffusionV1') },
  ].map((m) => ({ ...m, bit: Uint8Array.from(m.bit, (c) => (c === '1' ? 1 : 0)) }));

  const SCALA = 36;
  // Il codificatore di riferimento rifiuta le immagini più piccole: lì un marchio non c'è.
  const MIN_PIXEL = 256 * 256;
  // Il doppio della più grande che questi generatori scrivono (2048×2048), e ingrandirla il marchio lo cancella. Una
  // foto del telefono (12 MP) resta fuori: decodificarla costerebbe un secondo a ogni domanda in chat, per niente.
  const MAX_PIXEL = 2 * 2048 * 2048;
  // Fissata prima di provarla sulle foto vere: una foto senza marchio supera il test di un messaggio, in un ordine
  // dei canali, con probabilità al più ALFA. Senza marchio le medie per posizione sono scambiabili, e il test è esatto.
  const ALFA = 1e-9;

  function u8(x) {
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (x && x.buffer instanceof ArrayBuffer) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    return new Uint8Array(0);
  }

  function u32(b, i) { return b[i] * 0x1000000 + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]); }

  function dimensioniBuone(w, h) {
    return w > 0 && h > 0 && w * h >= MIN_PIXEL && w * h <= MAX_PIXEL;
  }

  // ─────────────────────────────── i pixel ────────────────────────────────

  // Solo quello che un generatore scrive: RGB o RGBA a 8 o 16 bit, non interlacciato. In un PNG grigio il marchio non sta.
  function pixelPng(b, zlib) {
    const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!zlib || b.length < 33 || firma.some((v, i) => b[i] !== v)) return null;
    let w = 0, h = 0, prof = 0, tipo = -1, interlacciato = 1;
    const idat = [];
    let totale = 0;
    for (let i = 8; i + 8 <= b.length;) {
      const len = u32(b, i);
      const d = i + 8;
      if (d + len > b.length) return null;
      const t = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
      if (t === 'IHDR' && len >= 13) {
        w = u32(b, d); h = u32(b, d + 4); prof = b[d + 8]; tipo = b[d + 9]; interlacciato = b[d + 12];
      } else if (t === 'IDAT') {
        idat.push(b.subarray(d, d + len));
        totale += len;
      } else if (t === 'IEND') break;
      i = d + len + 4;
    }
    if ((tipo !== 2 && tipo !== 6) || (prof !== 8 && prof !== 16) || interlacciato !== 0) return null;
    if (!dimensioniBuone(w, h) || !totale) return null;
    const passoPixel = (tipo === 6 ? 4 : 3) * (prof / 8);
    const passoRiga = w * passoPixel + 1;
    const compresso = new Uint8Array(totale);
    let o = 0;
    for (const pezzo of idat) { compresso.set(pezzo, o); o += pezzo.length; }
    let dati;
    // Il tetto è la misura che l'intestazione dichiara: un flusso che si gonfia oltre non è questa immagine.
    try { dati = zlib.inflateSync(compresso, { maxOutputLength: passoRiga * h }); } catch (_) { return null; }
    if (dati.length < passoRiga * h || !togliFiltri(dati, passoRiga, h, passoPixel)) return null;
    return { dati, w, h, passoRiga, inizio: 1, passoPixel, passoCanale: prof / 8 };
  }

  function togliFiltri(d, passoRiga, h, bpp) {
    for (let y = 0; y < h; y++) {
      const r = y * passoRiga;
      const filtro = d[r];
      const s = r + 1;
      const fine = r + passoRiga;
      if (filtro === 0) continue;
      if (filtro === 1) {
        for (let i = s + bpp; i < fine; i++) d[i] = (d[i] + d[i - bpp]) & 255;
      } else if (filtro === 2) {
        if (y) for (let i = s; i < fine; i++) d[i] = (d[i] + d[i - passoRiga]) & 255;
      } else if (filtro === 3) {
        for (let i = s; i < fine; i++) {
          const a = i - bpp >= s ? d[i - bpp] : 0;
          const c = y ? d[i - passoRiga] : 0;
          d[i] = (d[i] + ((a + c) >> 1)) & 255;
        }
      } else if (filtro === 4) {
        for (let i = s; i < fine; i++) {
          const a = i - bpp >= s ? d[i - bpp] : 0;
          const c = y ? d[i - passoRiga] : 0;
          const ac = y && i - bpp >= s ? d[i - bpp - passoRiga] : 0;
          const p = a + c - ac;
          const pa = Math.abs(p - a), pb = Math.abs(p - c), pc = Math.abs(p - ac);
          d[i] = (d[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? c : ac)) & 255;
        }
      } else return false;
    }
    return true;
  }

  // Larghezza, altezza e componenti dal primo SOF, senza decodificare.
  function intestazioneJpeg(b) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], componenti: b[i + 9] };
      }
      if (m === 0xd9 || m === 0xda) return null;
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return null;
  }

  // `decodifica` è jpeg-js (JS puro): un modulo nativo per architettura romperebbe il pacchetto universale per Mac.
  function pixelJpeg(b, decodifica) {
    if (typeof decodifica !== 'function' || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    const sof = intestazioneJpeg(b);
    if (!sof || sof.componenti !== 3 || !dimensioniBuone(sof.w, sof.h)) return null;
    let img;
    try {
      img = decodifica(b, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: Math.ceil(MAX_PIXEL / 1e6), maxMemoryUsageInMB: 384 });
    } catch (_) { return null; }
    if (!img || !img.data || !dimensioniBuone(img.width, img.height) || img.data.length < img.width * img.height * 3) return null;
    return { dati: img.data, w: img.width, h: img.height, passoRiga: img.width * 3, inizio: 0, passoPixel: 3, passoCanale: 1 };
  }

  // ────────────────────────────── la lettura ──────────────────────────────

  // La U di BGR2YUV di OpenCV come la vede il codificatore. Sugli 8 bit (interi a 14 bit, centro 128) per chi marca
  // un'immagine già salvata (Stable Diffusion 1); in virgola mobile (centro 0,5) per chi marca l'uscita del modello
  // prima di salvarla (diffusers, Stability, FLUX). Il blocco si legge sui valori grezzi, centro compreso: letto
  // nell'altro modo, un marchio di SDXL sembra rumore.
  function canaleU(b, g, r) {
    const y = (r * 4899 + g * 9617 + b * 1868 + 8192) >> 14;
    const v = ((b - y) * 8061 + 2105344) >> 14;
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }
  function canaleUVirgola(b, g, r) {
    return (b - (0.299 * r + 0.587 * g + 0.114 * b)) * 0.492 + 0.5;
  }

  // Il filtro di haar di pywt, nello stesso ordine di operazioni: prima le colonne, poi le righe. Così un
  // coefficiente sul confine fra 0 e 1 cade dalla stessa parte in cui cade per il decodificatore di riferimento.
  const K = Math.SQRT1_2;

  function punteggio(uu, ll) {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const p = 16 * r + 2 * c;
        const sinistra = K * uu[p] + K * uu[p + 8];
        const destra = K * uu[p + 1] + K * uu[p + 9];
        ll[4 * r + c] = K * sinistra + K * destra;
      }
    }
    let massimo = Math.abs(ll[1]);
    for (let k = 2; k < 16; k++) { const v = Math.abs(ll[k]); if (v > massimo) massimo = v; }
    return (massimo % SCALA) > SCALA / 2 ? 1 : 0;
  }

  // Un bit letto per ogni blocco di 8×8 pixel, nell'ordine in cui il codificatore li scrive. Quattro letture: i due
  // modi di calcolare U, e i due ordini dei canali (i generatori passano BGR, le prime versioni di diffusers RGB).
  function punteggi(px) {
    const { dati, w, h, passoRiga, inizio, passoPixel, passoCanale } = px;
    const bx = (((w >> 2) << 2) >> 1) >> 2;
    const by = (((h >> 2) << 2) >> 1) >> 2;
    const letture = [0, 1, 2, 3].map(() => new Uint8Array(bx * by));
    const uu = [0, 1, 2, 3].map(() => new Float64Array(64));
    const ll = new Float64Array(16);
    for (let i = 0; i < by; i++) {
      for (let j = 0; j < bx; j++) {
        for (let r = 0; r < 8; r++) {
          let p = (8 * i + r) * passoRiga + inizio + 8 * j * passoPixel;
          for (let c = 0; c < 8; c++, p += passoPixel) {
            const R = dati[p], G = dati[p + passoCanale], B = dati[p + 2 * passoCanale];
            const q = 8 * r + c;
            uu[0][q] = canaleU(B, G, R);
            uu[1][q] = canaleU(R, G, B);
            uu[2][q] = canaleUVirgola(B, G, R);
            uu[3][q] = canaleUVirgola(R, G, B);
          }
        }
        for (let l = 0; l < 4; l++) letture[l][i * bx + j] = punteggio(uu[l], ll);
      }
    }
    return letture;
  }

  // P(U ≥ u) senza marchio per ogni u: i coefficienti del binomiale gaussiano [n1+n0, n1]_q, contati esatti.
  const code = new Map();
  function coda(n1, n0) {
    const chiave = `${n1}:${n0}`;
    if (code.has(chiave)) return code.get(chiave);
    let righe = [Float64Array.of(1)];
    for (let n = 1; n <= n1 + n0; n++) {
      const nuove = [];
      for (let k = Math.max(0, n - n0); k <= Math.min(n, n1); k++) {
        const p = new Float64Array(k * (n - k) + 1);
        const a = righe[k - 1];
        if (a) for (let u = 0; u < a.length; u++) p[u] += a[u];
        const b = k <= n - 1 ? righe[k] : null;
        if (b) for (let u = 0; u < b.length; u++) p[u + k] += b[u];
        nuove[k] = p;
      }
      righe = nuove;
    }
    const f = righe[n1];
    let tot = 0;
    for (let u = 0; u < f.length; u++) tot += f[u];
    const t = new Float64Array(f.length + 1);
    for (let u = f.length - 1; u >= 0; u--) t[u] = t[u + 1] + f[u] / tot;
    code.set(chiave, t);
    return t;
  }

  // Quanto è improbabile, senza marchio, che le posizioni dove il messaggio ha 1 leggano più 1 di quelle dove ha 0.
  function probabilita(punti, bit) {
    const L = bit.length;
    const somme = new Float64Array(L), conte = new Float64Array(L);
    for (let k = 0; k < punti.length; k++) { const p = k % L; somme[p] += punti[k]; conte[p]++; }
    let n1 = 0, U = 0;
    for (let a = 0; a < L; a++) {
      if (!bit[a]) continue;
      n1++;
      for (let z = 0; z < L; z++) if (!bit[z] && somme[a] * conte[z] > somme[z] * conte[a]) U++;
    }
    return coda(n1, L - n1)[U];
  }

  // { marchio, chi, p } se c'è; { marchio: null } se i pixel si leggono e non lo portano; null se non si leggono.
  // `opzioni.jpeg`: il decodificatore JPEG; senza, i JPEG non si leggono.
  function cerca(byte, opzioni) {
    const b = u8(byte);
    const px = pixelPng(b, nodeMod('node:zlib')) || pixelJpeg(b, opzioni && opzioni.jpeg);
    if (!px) return null;
    const letture = punteggi(px);
    let migliore = null;
    for (const m of MARCHI) {
      if (letture[0].length < m.bit.length) continue;
      for (const punti of letture) {
        const p = probabilita(punti, m.bit);
        if (p <= ALFA && (!migliore || p < migliore.p)) migliore = { marchio: m.id, chi: m.chi, p };
      }
    }
    return migliore || { marchio: null };
  }

  global.SN_MARCHI_INVISIBILI = {
    cerca,
    MARCHI: MARCHI.map(({ id, chi }) => ({ id, chi })),
    _interni: { pixelPng, pixelJpeg, punteggi, probabilita, coda, canaleU, canaleUVirgola, ALFA, MIN_PIXEL, MAX_PIXEL },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
