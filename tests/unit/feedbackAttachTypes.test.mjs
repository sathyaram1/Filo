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

test('#1337: il nome che il sistema dà a un documento ammesso vale con l\'estensione della sua voce, e si dichiara col tipo della lista', () => {
  const casi = [
    ['diario.log', 'text/x-log', 'file', 'text/plain'],
    ['config.yaml', 'application/yaml', 'file', 'application/x-yaml'],
    ['config.yml', 'text/yaml', 'file', 'application/x-yaml'],
    ['misure.csv', 'application/vnd.ms-excel', 'file', 'text/csv'],
    ['note.md', 'text/x-markdown', 'file', 'text/markdown'],
    ['schema.json', 'application/schema+json', 'file', 'application/json'],
    ['vecchia.bmp', 'image/x-ms-bmp', 'image', 'image/bmp'],
    ['note.md', '', 'file', 'text/markdown'],
    ['shot.png', 'application/octet-stream', 'image', 'image/png'],
    ['n.txt', 'text/plain', 'file', 'text/plain'],
  ];
  for (const [name, type, kind, dichiarato] of casi) {
    assert.equal(f(name, type), kind, `${name} ${type}`);
    assert.equal(A.tipoDichiarato({ name, type }), dichiarato, `${name} ${type}`);
  }
  for (const [name, type] of [['conti.xls', 'application/vnd.ms-excel'], ['a.txt', 'application/yaml'], ['a.csv', 'text/x-log'], ['x.html', 'text/x-log'], ['travestito.txt', 'text/html']]) {
    assert.equal(f(name, type), null, `${name} ${type}`);
    assert.equal(A.tipoDichiarato({ name, type }), '', `${name} ${type}`);
  }
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

// ── Una lista sola: selettori, controllo, manifesto e `feedback:apri` leggono la stessa (#582.2) ──

test('il selettore offre esattamente i tipi che il controllo accetta, senza famiglie con l\'asterisco', () => {
  const voci = A.ACCEPT.split(',');
  assert.ok(!voci.some((v) => v.includes('*')), `famiglia con asterisco nel selettore: ${A.ACCEPT}`);
  for (const v of voci) {
    const prova = v.startsWith('.') ? f(`x${v}`, '') : f('x', v);
    assert.ok(prova, `il selettore offre ${v}, che il controllo rifiuta`);
  }
  for (const t of A.TIPI) {
    for (const m of t.mime) assert.ok(voci.includes(m), `${m} accettato ma non offerto`);
    for (const e of t.ext) assert.ok(voci.includes(`.${e}`), `.${e} accettato ma non offerto`);
  }
  assert.ok(voci.includes('.tsv') && voci.includes('text/tab-separated-values'), 'la tabella .tsv è offerta');
  for (const attivo of ['image/svg+xml', '.svg', 'text/html', '.html', 'text/*', 'image/*']) {
    assert.ok(!voci.includes(attivo), `${attivo} offerto`);
  }
});

test('i nomi dei documenti per le frasi vengono dalla stessa lista', () => {
  for (const t of A.TIPI.filter((x) => x.kind === 'file')) assert.ok(A.NOMI_DOCUMENTI.includes(t.nome), t.nome);
  assert.match(A.NOMI_DOCUMENTI, /TSV/);
  assert.match(A.NOMI_DOCUMENTI, / e YAML$/);
});

test('il tipo dichiarato da un\'estensione è sempre una stringa, e vuota fuori lista', () => {
  assert.equal(A.mimeDaEstensione('TSV'), 'text/tab-separated-values');
  assert.equal(A.mimeDaEstensione('yml'), 'application/x-yaml');
  assert.equal(A.mimeDaEstensione('jpg'), 'image/jpeg');
  for (const e of ['__proto__', 'constructor', 'svg', 'html', '', undefined]) assert.equal(A.mimeDaEstensione(e), '', String(e));
});

test('il manifesto dice che a una segnalazione si allegano anche documenti, coi nomi della lista', () => {
  require(join(__dirname, '..', '..', 'src', 'shared', 'capabilities.js'));
  const CAP = globalThis.SN_CAPABILITIES;
  const desc = CAP.get('feedback').desc;
  assert.ok(desc.includes(A.NOMI_DOCUMENTI), desc.slice(0, 200));
  for (const c of CAP.all({ redteam: true })) {
    for (const k of ['desc', 'invoke', 'doesNot']) assert.ok(!String(c[k] || '').includes('{tipiAllegato}'), `${c.id}.${k}`);
  }
});
