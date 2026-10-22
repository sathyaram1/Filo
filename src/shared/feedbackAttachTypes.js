// Allowlist degli allegati ammessi: `accept` su un <input type=file> è un suggerimento
// e non vincola né «Tutti i file» né il drop, quindi serve un gate deterministico.
// Rifiuta i tipi ATTIVI (text/html, svg…). La cintura è storage.rules, da tenere allineata.

(function (global) {
  'use strict';

  // NIENTE image/svg+xml: un SVG è un documento attivo, può contenere <script>.
  const RASTER_IMAGE_MIME = new Set([
    'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp',
  ]);

  // Documenti passivi per MIME esplicito, da tenere uguale a storage.rules.
  // NIENTE text/html, application/xhtml+xml, text/xml.
  const DOC_MIME = new Set([
    'text/plain', 'text/markdown', 'text/csv', 'application/pdf', 'application/json',
    // Col tipo esplicito perché il deposito li accetta: senza, la riga di comando mandava
    // quello che una persona non poteva allegare (#582).
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

  global.SN_FEEDBACK_ATTACH = {
    classify,
    RASTER_IMAGE_MIME,
    DOC_MIME,
    IMAGE_EXT,
    DOC_EXT,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
