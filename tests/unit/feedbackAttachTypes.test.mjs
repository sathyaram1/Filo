// Unit test per l'allowlist dei tipi di allegato del box feedback
// (src/shared/feedbackAttachTypes.js). Gira via `npm run test:unit` senza
// Electron né rete.
//
// Il bug che copre: trascinando un file nel box (drag & drop) veniva accettato
// QUALSIASI tipo, .html incluso — un vettore XSS/phishing su dominio Google
// Storage. La whitelist deve rifiutare i tipi "attivi" e accettare solo
// immagini raster + documenti passivi (pdf/txt/md/csv/json).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mimeDiAllegato } from '../../scripts/claude-feedback.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackAttachTypes.js'));

const A = globalThis.SN_FEEDBACK_ATTACH;
const f = (name, type) => A.classify({ name, type });

// ── I tipi ATTIVI vanno RIFIUTATI (il cuore del fix) ────────────────────────

test('rifiuta text/html anche con nome innocuo (il caso del bug)', () => {
  assert.equal(f('innocuo.html', 'text/html'), null);
  assert.equal(f('pagina.htm', 'text/html'), null);
});

test('rifiuta gli altri tipi attivi/eseguibili', () => {
  assert.equal(f('logo.svg', 'image/svg+xml'), null);       // SVG = attivo
  assert.equal(f('a.xhtml', 'application/xhtml+xml'), null);
  assert.equal(f('a.xml', 'text/xml'), null);
  assert.equal(f('a.xml', 'application/xml'), null);
  assert.equal(f('s.js', 'text/javascript'), null);
  assert.equal(f('s.js', 'application/javascript'), null);
});

test('un MIME esplicito pericoloso NON è salvato da un\'estensione benigna', () => {
  // .txt ma il SO lo tipizza text/html → resta rifiutato.
  assert.equal(f('travestito.txt', 'text/html'), null);
});

// ── Le immagini raster ammesse restano immagini ─────────────────────────────

test('accetta le immagini raster come "image"', () => {
  assert.equal(f('a.png', 'image/png'), 'image');
  assert.equal(f('a.jpg', 'image/jpeg'), 'image');
  assert.equal(f('a.gif', 'image/gif'), 'image');
  assert.equal(f('a.webp', 'image/webp'), 'image');
  assert.equal(f('a.bmp', 'image/bmp'), 'image');
});

// ── I documenti passivi ammessi restano allegati ────────────────────────────

test('accetta i documenti passivi come "file" (MIME esplicito)', () => {
  assert.equal(f('n.txt', 'text/plain'), 'file');
  assert.equal(f('n.md', 'text/markdown'), 'file');
  assert.equal(f('n.csv', 'text/csv'), 'file');
  assert.equal(f('n.pdf', 'application/pdf'), 'file');
  assert.equal(f('n.json', 'application/json'), 'file');
});

test('con MIME vuoto/generico decide l\'estensione dell\'allowlist', () => {
  // Il SO spesso non mappa .md/.yml/.log a un MIME: tipo vuoto o octet-stream.
  assert.equal(f('note.md', ''), 'file');
  assert.equal(f('conf.yml', ''), 'file');
  assert.equal(f('conf.yaml', 'application/octet-stream'), 'file');
  assert.equal(f('server.log', ''), 'file');
  assert.equal(f('data.csv', 'application/octet-stream'), 'file');
  assert.equal(f('shot.png', 'application/octet-stream'), 'image');
});

test('con MIME vuoto/generico un\'estensione non in allowlist è rifiutata', () => {
  assert.equal(f('pagina.html', ''), null);              // il drop del bug, MIME vuoto
  assert.equal(f('pagina.html', 'application/octet-stream'), null);
  assert.equal(f('app.exe', ''), null);
  assert.equal(f('archivio.zip', 'application/octet-stream'), null);
  assert.equal(f('senza-estensione', ''), null);
});

test('input mancanti/degeneri non esplodono e sono rifiutati', () => {
  assert.equal(A.classify(null), null);
  assert.equal(A.classify(undefined), null);
  assert.equal(f(undefined, undefined), null);
});

// ── La riga di comando: stesso elenco del riquadro (#582, #1518) ────────────
// Il deposito non tiene più una sua lista di tipi: l'elenco unico è questo, e
// `npm run feedback:apri` ammette quello che ammette una persona dal riquadro.

test('la riga di comando ammette gli stessi allegati del riquadro, né uno di più né uno di meno', () => {
  for (const ext of [...A.IMAGE_EXT, ...A.DOC_EXT]) {
    const nome = `a.${ext}`;
    const tipo = mimeDiAllegato(nome);
    assert.ok(tipo, `${nome}: il riquadro lo allega, la riga di comando no`);
    assert.equal(A.classify({ name: nome, type: tipo }), A.classify({ name: nome, type: '' }),
      `${nome}: la riga di comando lo dichiara ${tipo} e il riquadro lo classifica diverso`);
  }
  for (const nome of ['a.zip', 'a.exe', 'a.html', 'a.svg', 'a.octetstream', 'a']) {
    assert.equal(mimeDiAllegato(nome), '', `${nome}: la riga di comando lo manderebbe`);
  }
});

test('il tipo di un allegato è sempre una stringa, anche coi nomi di serie', () => {
  // Verifica #582, giro 7: la chiave è l'estensione di un nome di file, e in una
  // tabella normale `__proto__` e `constructor` ci sono già. Un file chiamato
  // `note.__proto__` si faceva dare un «tipo» che non è una stringa e partiva
  // con `data:[object Object]`.
  for (const nome of ['a.__proto__', 'a.constructor', 'a.tostring', 'a.valueof', 'a.exe', 'a']) {
    const tipo = mimeDiAllegato(nome);
    assert.equal(typeof tipo, 'string', `${nome}: il tipo non è una stringa`);
    assert.equal(tipo, '', `${nome}: tipo non ammesso accettato come «${String(tipo)}»`);
  }
  assert.equal(mimeDiAllegato('a.png'), 'image/png');
  assert.equal(mimeDiAllegato('a.yaml'), 'application/x-yaml');
});
