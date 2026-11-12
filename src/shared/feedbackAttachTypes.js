// Allowlist degli allegati ammessi: `accept` su un <input type=file> è un suggerimento
// e non vincola né «Tutti i file» né il drop, quindi serve un gate deterministico.
// Rifiuta i tipi ATTIVI (text/html, svg…). Elenco unico di riquadro, pagina dei feedback, caselle di Gestione e
// riga di comando; il gate L0 del server gli resta allineato. Il deposito vede solo blob cifrati (#1518).

(function (global) {
  'use strict';

  // NIENTE image/svg+xml: un SVG è un documento attivo, può contenere <script>.
  const RASTER_IMAGE_MIME = new Set([
    'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp',
  ]);

  // Documenti passivi per MIME esplicito. NIENTE text/html, application/xhtml+xml, text/xml.
  const DOC_MIME = new Set([
    'text/plain', 'text/markdown', 'text/csv', 'application/pdf', 'application/json',
    // Col tipo esplicito perché la riga di comando li dichiara così: senza, mandava quello
    // che una persona non poteva allegare (#582).
    'text/tab-separated-values', 'application/x-yaml',
  ]);

  // Ammesse SOLO con MIME vuoto o generico: il sistema non sempre mappa .md/.yml/.log.
  // Mai per «salvare» un MIME pericoloso: un .txt tipizzato text/html resta rifiutato.
  const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
  const DOC_EXT = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'yml', 'yaml', 'pdf']);

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  // Un MIME generico non dice nulla sul contenuto: solo lì ci fidiamo dell'estensione.
  function isGenericMime(t) {
    return !t || t === 'application/octet-stream';
  }

  function classify(file) {
    if (!file) return null;
    const type = String(file.type || '').toLowerCase().trim();
    const ext = extOf(file.name);

    if (RASTER_IMAGE_MIME.has(type)) return 'image';
    if (DOC_MIME.has(type)) return 'file';

    // MIME esplicito fuori allowlist → rifiuto a prescindere dall'estensione (.html trascinato).
    if (!isGenericMime(type)) return null;

    if (IMAGE_EXT.has(ext)) return 'image';
    if (DOC_EXT.has(ext)) return 'file';
    return null;
  }

  // Il selettore propone solo quello che `classify` accetta: con image/* e text/* offriva SVG e HTML, poi rifiutati.
  const ACCEPT = [...RASTER_IMAGE_MIME, ...DOC_MIME, ...[...IMAGE_EXT, ...DOC_EXT].map((e) => `.${e}`)].join(',');
  const AMMESSI = 'immagini (PNG, JPEG, GIF, WebP, BMP), PDF, testo, Markdown, CSV, TSV, JSON, YAML e log';
  const MESSAGGIO_TIPO = `Tipo di file non supportato. Ammessi: ${AMMESSI}.`;
  // Gli stessi tetti per ogni casella che allega: il deposito e il server li controllano di nuovo.
  const LIMITI = Object.freeze({ immagini: 5, file: 5, byte: 4 * 1024 * 1024 });

  global.SN_FEEDBACK_ATTACH = {
    classify,
    RASTER_IMAGE_MIME,
    DOC_MIME,
    IMAGE_EXT,
    DOC_EXT,
    ACCEPT,
    AMMESSI,
    MESSAGGIO_TIPO,
    LIMITI,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
