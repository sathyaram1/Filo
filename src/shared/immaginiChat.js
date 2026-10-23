// Un'immagine data a una chat di Filo, nella forma che il modello legge (#1623): PNG, JPEG, WebP o GIF entro il tetto.
// Gira solo dove c'è un canvas (pagine e content script), mai nel main. Regole:
// patterns/un-file-lasciato-dove-la-pagina-non-lo-vuole-va-alla-chat.md

(function (global) {
  'use strict';

  // I formati che i fornitori accettano tutti: il resto (SVG, BMP, TIFF, AVIF…) si ridisegna.
  const LETTA = /^data:image\/(png|jpeg|webp|gif);base64,/i;
  const tetti = () => (global.SN_CONST && global.SN_CONST.ALLEGATI_CHAT) || {};
  const byteDi = (dataUrl) => Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);

  const comeDataUrl = (blob) => new Promise((ok) => {
    try {
      const r = new FileReader();
      r.onload = () => ok(typeof r.result === 'string' ? r.result : '');
      r.onerror = () => ok('');
      r.readAsDataURL(blob);
    } catch (_) { ok(''); }
  });

  function blobDa(dataUrl) {
    try {
      const s = String(dataUrl || '');
      const tipo = (/^data:([^;,]+)/i.exec(s) || [])[1] || '';
      const bin = atob(s.slice(s.indexOf(',') + 1));
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return new Blob([u], { type: tipo });
    } catch (_) { return null; }
  }

  // createImageBitmap non apre l'SVG: per quello passa da un'<img>, che senza misure proprie prende quelle del disegno.
  async function apri(blob) {
    try {
      const bmp = await createImageBitmap(blob);
      return { src: bmp, w: bmp.width, h: bmp.height, chiudi: () => { try { bmp.close(); } catch (_) {} } };
    } catch (_) { /* sotto */ }
    let url = '';
    try {
      url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      await img.decode();
      const w = img.naturalWidth || 1024;
      const h = img.naturalHeight || w;
      return { src: img, w, h, chiudi: () => { try { URL.revokeObjectURL(url); } catch (_) {} } };
    } catch (_) {
      try { if (url) URL.revokeObjectURL(url); } catch (_) {}
      return null;
    }
  }

  function disegna(im, lato, tipo) {
    const k = Math.min(1, lato / Math.max(im.w, im.h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(im.w * k));
    c.height = Math.max(1, Math.round(im.h * k));
    const g = c.getContext('2d');
    if (tipo === 'image/jpeg') {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
    }
    g.drawImage(im.src, 0, 0, c.width, c.height);
    return c.toDataURL(tipo, 0.85);
  }

  // Torna il data: da mandare, o '' se l'immagine non si apre (anche un file rovinato col nome giusto: il modello
  // lo rifiuterebbe). Entro il tetto e in un formato letto resta com'è; un altro formato diventa PNG (tiene la
  // trasparenza di un logo); oltre il tetto si rimpicciolisce in JPEG finché ci sta.
  async function perLaChat(blob) {
    if (!blob) return '';
    const tetto = tetti().tettoImmagineByte || 4 * 1024 * 1024;
    const lato = tetti().latoRimpicciolita || 2048;
    const im = await apri(blob);
    if (!im) return '';
    try {
      if (blob.size <= tetto) {
        const url = await comeDataUrl(blob);
        if (LETTA.test(url)) return url;
        const url = disegna(im, Math.min(lato, Math.max(im.w, im.h)), 'image/png');
        if (LETTA.test(url) && byteDi(url) <= tetto) return url;
      }
      for (let l = lato; l >= 256; l = Math.floor(l * 0.7)) {
        const url = disegna(im, l, 'image/jpeg');
        if (LETTA.test(url) && byteDi(url) <= tetto) return url;
      }
      return '';
    } catch (_) {
      return '';
    } finally {
      im.chiudi();
    }
  }

  global.SN_IMMAGINI_CHAT = { perLaChat, blobDa, byteDi, LETTA };
})(typeof globalThis !== 'undefined' ? globalThis : self);
