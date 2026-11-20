// Un'immagine data a una chat di Filo (#1623), allegata a una segnalazione (#1664) o da trascrivere (#2374), nella forma
// che chi la riceve legge: PNG, JPEG, WebP o GIF entro il tetto. Converte solo dove c'è un canvas; il main ne usa INTERA.
// Regole: patterns/un-file-lasciato-dove-la-pagina-non-lo-vuole-va-alla-chat.md

(function (global) {
  'use strict';

  // I formati che i fornitori accettano tutti: il resto (SVG, BMP, TIFF, AVIF…) si ridisegna. INTERA è il controllo di
  // chi riceve il data: da un altro processo (lo strato sopra la scheda).
  const FORMATI = 'png|jpeg|webp|gif';
  const LETTA = new RegExp(`^data:image\\/(${FORMATI});base64,`, 'i');
  const INTERA = new RegExp(`^data:image\\/(${FORMATI});base64,[A-Za-z0-9+/=]+$`);
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

  function disegna(im, lato, tipo, fondo = '') {
    const k = Math.min(1, lato / Math.max(im.w, im.h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(im.w * k));
    c.height = Math.max(1, Math.round(im.h * k));
    const g = c.getContext('2d');
    if (fondo || tipo === 'image/jpeg') {
      g.fillStyle = fondo || '#fff';
      g.fillRect(0, 0, c.width, c.height);
    }
    g.drawImage(im.src, 0, 0, c.width, c.height);
    return c.toDataURL(tipo, 0.85);
  }

  const COLORE = /^#[0-9a-f]{6}$/i;
  const luce = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const SCURO = '#1f1d1a';
  const CHIARO = '#ffffff';
  // Sotto quanto stacco fra il disegno e il fondo della pagina una scritta non si legge più (luminosità 0..1).
  const STACCO_MINIMO = 0.25;

  // Il fondo su cui posare un'immagine con parti trasparenti, perché resti com'era sulla pagina: il colore della pagina
  // sotto di lei, o l'opposto del disegno se su quel colore non si staccherebbe (un logo bianco pensato per una foto
  // scura). '' se l'immagine è tutta piena: allora non si ridisegna.
  function fondoDietro(im, fondo) {
    let d;
    try {
      const k = Math.min(1, 256 / Math.max(im.w, im.h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.w * k));
      c.height = Math.max(1, Math.round(im.h * k));
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(im.src, 0, 0, c.width, c.height);
      d = g.getImageData(0, 0, c.width, c.height).data;
    } catch (_) { return fondo; }
    let trasparente = false;
    let somma = 0;
    let peso = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      if (a < 0.98) trasparente = true;
      somma += a * luce(d[i], d[i + 1], d[i + 2]);
      peso += a;
    }
    if (!trasparente) return '';
    if (!peso) return fondo;
    const disegno = somma / peso;
    const n = Number.parseInt(fondo.slice(1), 16);
    const pagina = luce((n >> 16) & 255, (n >> 8) & 255, n & 255);
    if (Math.abs(disegno - pagina) >= STACCO_MINIMO) return fondo;
    return disegno > 0.5 ? SCURO : CHIARO;
  }

  // Torna il data: da mandare, o '' se l'immagine non si apre (anche un file rovinato col nome giusto: il modello
  // lo rifiuterebbe). Entro il tetto e in un formato letto resta com'è; un altro formato diventa PNG (tiene la
  // trasparenza di un logo); oltre il tetto si rimpicciolisce in JPEG finché ci sta. Con `fondo` ('#rrggbb', il colore
  // della pagina sotto l'immagine) una trasparenza si riempie come la mostrava la pagina: chi legge vede quello che
  // vedeva l'utente, non una scritta chiara su bianco.
  function perLaChat(blob, { fondo = '' } = {}) {
    const f = COLORE.test(String(fondo)) ? String(fondo) : '';
    return entroIlTetto(blob, tetti().tettoImmagineByte || 4 * 1024 * 1024, tetti().latoRimpicciolita || 2048, f);
  }

  async function entroIlTetto(blob, tetto, lato, fondo = '') {
    if (!blob) return '';
    const im = await apri(blob);
    if (!im) return '';
    try {
      const sotto = fondo && !/^image\/jpeg$/i.test(blob.type || '') ? fondoDietro(im, fondo) : '';
      if (blob.size <= tetto) {
        const originale = await comeDataUrl(blob);
        if (!sotto && LETTA.test(originale)) return originale;
        const png = disegna(im, Math.min(lato, Math.max(im.w, im.h)), 'image/png', sotto);
        if (LETTA.test(png) && byteDi(png) <= tetto) return png;
      }
      for (let l = lato; l >= 256; l = Math.floor(l * 0.7)) {
        const url = disegna(im, l, 'image/jpeg', sotto);
        if (LETTA.test(url) && byteDi(url) <= tetto) return url;
      }
      return '';
    } catch (_) {
      return '';
    } finally {
      im.chiudi();
    }
  }

  const MOTIVO_FORMATO = 'formato che Filo non sa aprire (salvala come JPEG o PNG)';
  // Chi la legge è l'owner, non un modello: tiene più dettaglio della chat, e una foto da 12 MP ci sta già in JPEG.
  const LATO_SEGNALAZIONE = 4096;

  const attach = () => global.SN_FEEDBACK_ATTACH;
  const ammessa = (file) => !!attach() && typeof attach().classify === 'function' && attach().classify(file) === 'image';

  // Un'immagine fuori dai tipi ammessi che però si può aprire e ridisegnare. L'SVG resta fuori: è un documento
  // attivo (src/shared/feedbackAttachTypes.js).
  function daRidisegnare(file) {
    if (!file || !attach() || ammessa(file)) return false;
    const tipo = String(file.type || '').toLowerCase().trim();
    if (tipo.startsWith('image/')) return !tipo.includes('svg');
    const ext = (/\.([a-z0-9]+)$/i.exec(String(file.name || '')) || [])[1] || '';
    const A = attach();
    const nota = (s) => !!(s && typeof s.has === 'function' && s.has(ext.toLowerCase()));
    return (!tipo || tipo === 'application/octet-stream') && (nota(A.RIDISEGNABILI_EXT) || nota(A.NON_APRIBILI_EXT));
  }

  // Quanti fotogrammi ha una GIF, leggendo i blocchi senza decodificarli: una animata ridisegnata resta ferma, e
  // chi la manda deve saperlo. 0 se i byte non sono una GIF.
  function fotogrammiGif(byte) {
    const b = byte instanceof Uint8Array ? byte : new Uint8Array(byte || []);
    if (b.length < 13 || String.fromCharCode(b[0], b[1], b[2]) !== 'GIF') return 0;
    let i = 13 + ((b[10] & 0x80) ? 3 * (2 << (b[10] & 7)) : 0);
    const salta = () => { while (i < b.length && b[i] !== 0) i += b[i] + 1; i += 1; };
    let n = 0;
    while (i < b.length) {
      const t = b[i];
      if (t === 0x3b) break;
      if (t === 0x21) { i += 2; salta(); continue; }
      if (t !== 0x2c) break;
      n += 1;
      const f = b[i + 9];
      i += 10 + ((f & 0x80) ? 3 * (2 << (f & 7)) : 0) + 1;
      salta();
    }
    return n;
  }
  const AVVISO_FERMA = 'entrata ferma, perché l’animazione non stava nei 4 MB';
  async function animata(file) {
    try { return fotogrammiGif(new Uint8Array(await file.arrayBuffer())) > 1; } catch (_) { return false; }
  }

  // Una foto del telefono passa spesso i 4 MB, e un AVIF non era fra i tipi ammessi (#1664): prima di rifiutarla si
  // rimpicciolisce o si ridisegna. Torna { file } da allegare, { motivo } se non si può, null se non è un'immagine.
  async function perLaSegnalazione(file) {
    if (!file || !attach()) return null;
    const L = attach().LIMITI || {};
    const tetto = L.byte || 4 * 1024 * 1024;
    const nome = String(file.name || '');
    const buona = ammessa(file);
    if (buona && file.size <= tetto) return { file };
    if (!buona && !daRidisegnare(file)) return null;
    const url = await entroIlTetto(file, tetto, LATO_SEGNALAZIONE);
    const blob = url ? blobDa(url) : null;
    if (!blob) return { motivo: buona ? `troppo grande (max ${Math.round(tetto / 1048576)} MB)` : MOTIVO_FORMATO };
    const gif = /^image\/gif$/i.test(file.type || '') || /\.gif$/i.test(nome);
    const avviso = gif && await animata(file) ? { avviso: AVVISO_FERMA } : {};
    try { return { file: new File([blob], nome || 'immagine', { type: blob.type }), ...avviso }; } catch (_) {
      blob.name = nome;
      return { file: blob, ...avviso };
    }
  }

  global.SN_IMMAGINI_CHAT = { perLaChat, perLaSegnalazione, daRidisegnare, fotogrammiGif, blobDa, byteDi, LETTA, INTERA };
})(typeof globalThis !== 'undefined' ? globalThis : self);
