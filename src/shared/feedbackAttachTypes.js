// Tipi di allegato dei feedback: la lista UNICA da cui leggono il controllo (classify), i selettori di file (ACCEPT),
// il manifesto delle capacità (NOMI_DOCUMENTI) e `npm run feedback:apri` (mimeDaEstensione).
// Mai tipi attivi (text/html, image/svg+xml); il gate L0 del server gli resta allineato. Il deposito vede solo blob cifrati (#1518).

(function (global) {
  'use strict';

  // `mime[0]` è il tipo con cui si dichiara un file riconosciuto solo dall'estensione.
  const TIPI = Object.freeze([
    { nome: 'PNG', kind: 'image', mime: ['image/png'], ext: ['png'] },
    { nome: 'JPEG', kind: 'image', mime: ['image/jpeg', 'image/jpg'], ext: ['jpg', 'jpeg'] },
    { nome: 'GIF', kind: 'image', mime: ['image/gif'], ext: ['gif'] },
    { nome: 'WebP', kind: 'image', mime: ['image/webp'], ext: ['webp'] },
    { nome: 'BMP', kind: 'image', mime: ['image/bmp'], ext: ['bmp'] },
    { nome: 'PDF', kind: 'file', mime: ['application/pdf'], ext: ['pdf'] },
    { nome: 'testo', kind: 'file', mime: ['text/plain'], ext: ['txt', 'log'] },
    { nome: 'markdown', kind: 'file', mime: ['text/markdown'], ext: ['md', 'markdown'] },
    { nome: 'CSV', kind: 'file', mime: ['text/csv'], ext: ['csv'] },
    { nome: 'TSV', kind: 'file', mime: ['text/tab-separated-values'], ext: ['tsv'] },
    { nome: 'JSON', kind: 'file', mime: ['application/json'], ext: ['json'] },
    { nome: 'YAML', kind: 'file', mime: ['application/x-yaml'], ext: ['yaml', 'yml'] },
  ].map((t) => Object.freeze({ ...t, mime: Object.freeze(t.mime.slice()), ext: Object.freeze(t.ext.slice()) })));

  const di = (kind, campo) => new Set(TIPI.filter((t) => t.kind === kind).flatMap((t) => t[campo]));
  const RASTER_IMAGE_MIME = di('image', 'mime');
  const DOC_MIME = di('file', 'mime');
  const IMAGE_EXT = di('image', 'ext');
  const DOC_EXT = di('file', 'ext');

  // Map e non oggetto: la chiave è l'estensione di un nome di file, e `note.__proto__` non deve trovare niente.
  const MIME_PER_EXT = new Map(TIPI.flatMap((t) => t.ext.map((e) => [e, t.mime[0]])));

  // Tipi esatti ed estensioni, mai famiglie con l'asterisco: `image/*` e `text/*` offrono SVG e HTML, che classify rifiuta.
  const ACCEPT = [
    ...TIPI.flatMap((t) => t.mime),
    ...TIPI.flatMap((t) => t.ext.map((e) => `.${e}`)),
  ].join(',');

  const nomiDoc = TIPI.filter((t) => t.kind === 'file').map((t) => t.nome);
  const NOMI_DOCUMENTI = `${nomiDoc.slice(0, -1).join(', ')} e ${nomiDoc[nomiDoc.length - 1]}`;

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function mimeDaEstensione(ext) {
    return MIME_PER_EXT.get(String(ext || '').toLowerCase()) || '';
  }

  // Un MIME vuoto o generico non dice niente sul contenuto: solo allora decide l'estensione (il SO non sempre
  // tipizza .md/.yml/.log). Un MIME esplicito fuori lista resta rifiutato anche con un'estensione benigna.
  function classify(file) {
    if (!file) return null;
    const type = String(file.type || '').toLowerCase().trim();
    if (RASTER_IMAGE_MIME.has(type)) return 'image';
    if (DOC_MIME.has(type)) return 'file';
    if (type && type !== 'application/octet-stream') return null;
    const ext = extOf(file.name);
    if (IMAGE_EXT.has(ext)) return 'image';
    if (DOC_EXT.has(ext)) return 'file';
    return null;
  }

  global.SN_FEEDBACK_ATTACH = {
    classify,
    mimeDaEstensione,
    TIPI,
    ACCEPT,
    NOMI_DOCUMENTI,
    RASTER_IMAGE_MIME,
    DOC_MIME,
    IMAGE_EXT,
    DOC_EXT,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
