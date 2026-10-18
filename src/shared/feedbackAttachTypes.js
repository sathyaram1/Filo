// Tipi di allegato dei feedback: la lista UNICA da cui leggono il controllo (classify), i selettori di file (ACCEPT),
// il manifesto delle capacità (NOMI_DOCUMENTI) e `npm run feedback:apri` (mimeDaEstensione).
// Mai tipi attivi (text/html, image/svg+xml); il gate L0 del server gli resta allineato. Il deposito vede solo blob cifrati (#1518).

(function (global) {
  'use strict';

  // `mime[0]` è il tipo con cui si dichiara un file riconosciuto solo dall'estensione. `alias`: come lo chiamano i
  // sistemi (Linux per .log e .yaml, Windows con Excel per .csv); vale solo con un'estensione della stessa voce.
  const TIPI = Object.freeze([
    { nome: 'PNG', kind: 'image', mime: ['image/png'], ext: ['png'] },
    { nome: 'JPEG', kind: 'image', mime: ['image/jpeg', 'image/jpg'], ext: ['jpg', 'jpeg'] },
    { nome: 'GIF', kind: 'image', mime: ['image/gif'], ext: ['gif'] },
    { nome: 'WebP', kind: 'image', mime: ['image/webp'], ext: ['webp'] },
    { nome: 'BMP', kind: 'image', mime: ['image/bmp'], ext: ['bmp'], alias: ['image/x-bmp', 'image/x-ms-bmp'] },
    { nome: 'PDF', kind: 'file', mime: ['application/pdf'], ext: ['pdf'] },
    { nome: 'testo', kind: 'file', mime: ['text/plain'], ext: ['txt', 'log'], alias: ['text/x-log'] },
    { nome: 'markdown', kind: 'file', mime: ['text/markdown'], ext: ['md', 'markdown'], alias: ['text/x-markdown'] },
    { nome: 'CSV', kind: 'file', mime: ['text/csv'], ext: ['csv'],
      alias: ['application/vnd.ms-excel', 'application/csv', 'text/x-csv', 'application/x-csv', 'text/comma-separated-values'] },
    { nome: 'TSV', kind: 'file', mime: ['text/tab-separated-values'], ext: ['tsv'], alias: ['text/tsv'] },
    { nome: 'JSON', kind: 'file', mime: ['application/json'], ext: ['json'], alias: ['application/schema+json', 'text/json'] },
    { nome: 'YAML', kind: 'file', mime: ['application/x-yaml'], ext: ['yaml', 'yml'], alias: ['application/yaml', 'text/yaml', 'text/x-yaml'] },
  ].map((t) => Object.freeze({
    ...t, mime: Object.freeze(t.mime.slice()), ext: Object.freeze(t.ext.slice()), alias: Object.freeze((t.alias || []).slice()),
  })));

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

  const VOCE_PER_EXT = new Map(TIPI.flatMap((t) => t.ext.map((e) => [e, t])));

  // Un MIME vuoto o generico non dice niente sul contenuto: solo allora decide l'estensione (il SO non sempre
  // tipizza .md/.yml/.log). Un MIME esplicito fuori lista resta rifiutato anche con un'estensione benigna, salvo
  // l'alias della voce di quell'estensione.
  function voceDi(file) {
    if (!file) return null;
    const type = String(file.type || '').toLowerCase().trim();
    const perExt = VOCE_PER_EXT.get(extOf(file.name)) || null;
    const perMime = TIPI.find((t) => t.mime.includes(type));
    if (perMime) return { voce: perMime, type };
    if (!type || type === 'application/octet-stream') return perExt ? { voce: perExt, type: perExt.mime[0] } : null;
    if (perExt && perExt.alias.includes(type)) return { voce: perExt, type: perExt.mime[0] };
    return null;
  }

  function classify(file) {
    const v = voceDi(file);
    return v ? v.voce.kind : null;
  }

  // Il tipo con cui il file va dichiarato nel feedback: sempre uno della lista, mai l'alias del sistema, che il gate
  // del server non conosce. '' se il file non è ammesso.
  function tipoDichiarato(file) {
    const v = voceDi(file);
    return v ? v.type : '';
  }

  global.SN_FEEDBACK_ATTACH = {
    classify,
    tipoDichiarato,
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
