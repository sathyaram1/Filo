// Il marchio invisibile aperto dei programmi di Stable Diffusion, letto dai pixel (#711).
// Gira dove l'immagine è già decodificata per mostrarla (pagina, chat), mai nel processo principale.
// Regole: patterns/unetichetta-di-origine-e-una-dichiarazione-non-una-prova.md

(function (global) {
  'use strict';

  // Libreria invisible-watermark, metodo dwtDct: un bit per blocco 4×4 dei coefficienti
  // di Haar del canale U. Si riconosce solo un messaggio noto: un'immagine qualsiasi dà bit a caso.
  function bitDaTesto(testo) {
    const out = [];
    for (const c of testo) { const n = c.charCodeAt(0); for (let k = 7; k >= 0; k--) out.push((n >> k) & 1); }
    return out;
  }
  const MARCHI = [
    { ente: 'Stable Diffusion', bit: bitDaTesto('StableDiffusionV1') },
    { ente: 'Stable Diffusion', bit: bitDaTesto('SDV2') },
    // SDXL (diffusers): 48 bit fissi.
    { ente: 'Stable Diffusion', bit: '101100111110110010010000011110111011000110011110'.split('').map(Number) },
  ];
  const ENTI = Array.from(new Set(MARCHI.map((m) => m.ente)));
  const SCALA = 36;
  // Il messaggio si ripete in tutta l'immagine: una fascia di 2 megapixel basta a
  // leggerlo e tiene il calcolo sotto i cinquanta millisecondi anche su una foto grande.
  const PIXEL_FASCIA = 2 * 1024 * 1024;

  function righeDaLeggere(larghezza, altezza) {
    const colonne = Math.floor(larghezza / 4) * 4;
    const righe = Math.floor(altezza / 4) * 4;
    if (colonne < 8 || righe < 8) return 0;
    return Math.min(righe, Math.max(8, Math.floor(PIXEL_FASCIA / colonne / 8) * 8));
  }

  // `rossoPrima`: il codificatore vuole BGR, ma c'è chi gli passa RGB (diffusers per SDXL).
  function bitDeiBlocchi(px, larghezza, altezza, rossoPrima) {
    const colonne = Math.floor(larghezza / 4) * 4;
    const righe = Math.min(righeDaLeggere(larghezza, altezza), Math.floor(altezza / 4) * 4);
    if (!righe) return [];
    const r = rossoPrima ? 0 : 2;
    const b = rossoPrima ? 2 : 0;
    // Aritmetica intera di OpenCV per BGR→YUV: la stessa che ha scritto il marchio.
    const U = new Uint8Array(colonne * righe);
    for (let y = 0; y < righe; y++) {
      for (let x = 0; x < colonne; x++) {
        const i = (y * larghezza + x) * 4;
        const Y = (px[i + r] * 4899 + px[i + 1] * 9617 + px[i + b] * 1868 + 8192) >> 14;
        const u = ((px[i + b] - Y) * 8061 + (128 << 14) + 8192) >> 14;
        U[y * colonne + x] = u < 0 ? 0 : (u > 255 ? 255 : u);
      }
    }
    const cc = colonne / 2;
    const cr = righe / 2;
    const ca = new Float64Array(cc * cr);
    for (let y = 0; y < cr; y++) {
      for (let x = 0; x < cc; x++) {
        const i = 2 * y * colonne + 2 * x;
        ca[y * cc + x] = (U[i] + U[i + 1] + U[i + colonne] + U[i + colonne + 1]) / 2;
      }
    }
    const out = [];
    const br = Math.floor(cr / 4);
    const bc = Math.floor(cc / 4);
    for (let bi = 0; bi < br; bi++) {
      for (let bj = 0; bj < bc; bj++) {
        let massimo = -1;
        for (let k = 1; k < 16; k++) {
          const v = Math.abs(ca[(bi * 4 + (k >> 2)) * cc + bj * 4 + (k & 3)]);
          if (v > massimo) massimo = v;
        }
        out.push((massimo % SCALA) > 0.5 * SCALA ? 1 : 0);
      }
    }
    return out;
  }

  // `px`: pixel a 4 canali, RGBA o BGRA (si provano tutti e due). Torna { ente } o null.
  function leggi(px, larghezza, altezza) {
    if (!px || !larghezza || !altezza || px.length < larghezza * altezza * 4) return null;
    for (const rossoPrima of [false, true]) {
      const bit = bitDeiBlocchi(px, larghezza, altezza, rossoPrima);
      for (const m of MARCHI) {
        const n = m.bit.length;
        if (bit.length < 2 * n) continue;
        const somme = new Array(n).fill(0);
        const conte = new Array(n).fill(0);
        for (let k = 0; k < bit.length; k++) { somme[k % n] += bit[k]; conte[k % n]++; }
        let errori = 0;
        for (let k = 0; k < n; k++) if (((somme[k] / conte[k]) * 255 > 127 ? 1 : 0) !== m.bit[k]) errori++;
        // Un errore ogni 48 bit si perdona: un'immagine qualunque ci arriva meno di una volta su 10^12.
        if (errori <= Math.floor(n / 48)) return { ente: m.ente };
      }
    }
    return null;
  }

  // Dai byte già scaricati: il browser decodifica fuori dal thread della pagina, senza
  // correggere i colori (il marchio sta nei valori scritti nel file). Mai un'eccezione.
  async function daBlob(blob) {
    try {
      if (!blob || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      try {
        const righe = righeDaLeggere(bmp.width, bmp.height);
        if (!righe) return null;
        const tela = new OffscreenCanvas(bmp.width, righe);
        const ctx = tela.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        const dati = ctx.getImageData(0, 0, bmp.width, righe);
        return leggi(dati.data, bmp.width, righe);
      } finally {
        try { bmp.close(); } catch (_) {}
      }
    } catch (_) {
      return null;
    }
  }

  global.SN_MARCHIO = { ENTI, leggi, daBlob };
})(typeof globalThis !== 'undefined' ? globalThis : this);
