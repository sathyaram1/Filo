// Allowlist dei tipi di allegato ammessi nel box "Invia feedback".
//
// Perché esiste: il box permette di allegare file sia con il pulsante "Allega"
// sia trascinandoli dentro (drag & drop). L'attributo `accept` di un <input
// type=file> è solo un suggerimento per il picker e NON vincola né la selezione
// "Tutti i file" del picker né i file letti da `dataTransfer.files` nel drop.
// Serve quindi un gate deterministico lato client, condiviso da ENTRAMBI i
// cammini, che rifiuti i tipi "attivi" (eseguibili nel dominio di Google
// Storage quando chi fa triage apre il link): text/html, image/svg+xml, ecc.
//
// Questa è la prima linea (UX: rifiuto immediato con messaggio). La cintura
// vera è `storage.rules` (stessa allowlist lato server). Tieni le due liste
// allineate.
//
// classify({ name, type }) -> 'image' | 'file' | null
//   'image' → anteprima immagine (raster)
//   'file'  → pillola allegato (pdf/txt/md/csv/json…)
//   null    → tipo NON ammesso, va rifiutato

(function (global) {
  'use strict';

  // Immagini raster ammesse. NIENTE image/svg+xml: l'SVG è un documento attivo
  // (può contenere <script>) e non va accettato come "immagine".
  const RASTER_IMAGE_MIME = new Set([
    'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp',
  ]);

  // Documenti passivi ammessi per MIME esplicito. Deve combaciare con
  // storage.rules. NIENTE text/html / application/xhtml+xml / text/xml.
  const DOC_MIME = new Set([
    'text/plain', 'text/markdown', 'text/csv', 'application/pdf', 'application/json',
  ]);

  // Estensioni ammesse SOLO quando il MIME è vuoto o generico
  // (application/octet-stream): il sistema operativo non sempre mappa .md/.yml/
  // .log/.csv a un MIME, e il picker le elenca via `accept`. Non usiamo mai
  // l'estensione per "salvare" un MIME esplicito e pericoloso (es. un .txt che
  // il SO tipizza text/html resta rifiutato).
  const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
  const DOC_EXT = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'log', 'yml', 'yaml', 'pdf']);

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  // Un MIME "generico" non dice nulla sul contenuto: solo in questo caso ci
  // fidiamo dell'estensione.
  function isGenericMime(t) {
    return !t || t === 'application/octet-stream';
  }

  function classify(file) {
    if (!file) return null;
    const type = String(file.type || '').toLowerCase().trim();
    const ext = extOf(file.name);

    // 1) MIME esplicito e ammesso → decide da solo (nessun override via estensione).
    if (RASTER_IMAGE_MIME.has(type)) return 'image';
    if (DOC_MIME.has(type)) return 'file';

    // 2) MIME esplicito ma NON in allowlist (text/html, image/svg+xml, …) → rifiuta,
    //    a prescindere dall'estensione. È il caso del .html trascinato.
    if (!isGenericMime(type)) return null;

    // 3) MIME vuoto/generico → decidi dall'estensione dell'allowlist.
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
