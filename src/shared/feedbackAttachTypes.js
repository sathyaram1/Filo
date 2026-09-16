// Allowlist degli allegati ammessi nel box «Invia feedback», per il pulsante «Allega» e per il trascinamento: `accept` su un <input type=file> è solo un suggerimento e non vincola né «Tutti i file» né il drop.
// Serve un gate deterministico che rifiuti i tipi ATTIVI (text/html, image/svg+xml…), eseguibili nel dominio di Google Storage quando chi fa triage apre il link. Prima linea soltanto: la cintura è `storage.rules`, con la stessa allowlist — da tenere allineate.
// classify({ name, type }) → 'image' | 'file' | null (non ammesso).

(function (global) {
  'use strict';

  // Immagini raster. NIENTE image/svg+xml: un SVG è un documento attivo (può contenere <script>).
  const RASTER_IMAGE_MIME = new Set([
    'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp',
  ]);

  // Documenti passivi ammessi per MIME esplicito, da tenere uguale a storage.rules. NIENTE text/html, application/xhtml+xml, text/xml.
  const DOC_MIME = new Set([
    'text/plain', 'text/markdown', 'text/csv', 'application/pdf', 'application/json',
    // `.tsv` e `.yaml` col loro tipo esplicito: senza, un .yaml tipizzato `application/x-yaml` era rifiutato qui mentre il deposito lo accettava, e la riga di comando mandava quello che una persona non poteva allegare (#582).
    'text/tab-separated-values', 'application/x-yaml',
  ]);

  // Estensioni ammesse SOLO con MIME vuoto o generico: il sistema non sempre mappa .md/.yml/.log/.csv. Mai per «salvare» un MIME esplicito pericoloso: un .txt tipizzato text/html resta rifiutato.
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

    // MIME esplicito ma fuori allowlist (text/html, image/svg+xml…) → rifiuto a prescindere dall'estensione: è il caso del .html trascinato.
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
