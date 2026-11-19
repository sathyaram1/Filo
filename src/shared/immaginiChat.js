// Un'immagine data a una chat di Filo (#1623) o allegata a una segnalazione (#1664), nella forma che chi la riceve
// legge: PNG, JPEG, WebP o GIF entro il tetto. Gira solo dove c'è un canvas (pagine e content script), mai nel main.
// Regole: patterns/un-file-lasciato-dove-la-pagina-non-lo-vuole-va-alla-chat.md

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
  function perLaChat(blob) {
    return entroIlTetto(blob, tetti().tettoImmagineByte || 4 * 1024 * 1024, tetti().latoRimpicciolita || 2048);
  }

  async function entroIlTetto(blob, tetto, lato) {
    if (!blob) return '';
    const im = await apri(blob);
    if (!im) return '';
    try {
      if (blob.size <= tetto) {
        const originale = await comeDataUrl(blob);
        if (LETTA.test(originale)) return originale;
        const png = disegna(im, Math.min(lato, Math.max(im.w, im.h)), 'image/png');
        if (LETTA.test(png) && byteDi(png) <= tetto) return png;
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

  // Le estensioni d'immagine che il sistema può dare senza tipo, oltre a quelle già ammesse.
  const ALTRE_ESTENSIONI = /\.(avif|heic|heif|tiff?|ico|jfif)$/i;
  const MOTIVO_FORMATO = 'formato che Filo non sa aprire (salvala come JPEG o PNG)';

  // Una foto del telefono passa spesso i 4 MB, e un AVIF non era fra i tipi ammessi (#1664): prima di rifiutarla si
  // rimpicciolisce o si ridisegna. Torna { file } da allegare, { motivo } se non si può, null se non è un'immagine.
  // L'SVG resta fuori: è un documento attivo (src/shared/feedbackAttachTypes.js).
  async function perLaSegnalazione(file) {
    const AT = global.SN_FEEDBACK_ATTACH;
    if (!file || !AT || typeof AT.classify !== 'function') return null;
    const tetto = (AT.LIMITI && AT.LIMITI.byte) || 4 * 1024 * 1024;
    const tipo = String(file.type || '').toLowerCase();
    const nome = String(file.name || '');
    const ammessa = AT.classify(file) === 'image';
    if (ammessa && file.size <= tetto) return { file };
    const daProvare = ammessa
      || (tipo.startsWith('image/') && !tipo.includes('svg'))
      || ((!tipo || tipo === 'application/octet-stream') && ALTRE_ESTENSIONI.test(nome));
    if (!daProvare) return null;
    const url = await entroIlTetto(file, tetto, LATO_SEGNALAZIONE);
    const blob = url ? blobDa(url) : null;
    if (!blob) return { motivo: ammessa ? `troppo grande (max ${Math.round(tetto / 1048576)} MB)` : MOTIVO_FORMATO };
    try { return { file: new File([blob], nome || 'immagine', { type: blob.type }) }; } catch (_) {
      blob.name = nome;
      return { file: blob };
    }
  }

  global.SN_IMMAGINI_CHAT = { perLaChat, perLaSegnalazione, blobDa, byteDi, LETTA };
})(typeof globalThis !== 'undefined' ? globalThis : self);
