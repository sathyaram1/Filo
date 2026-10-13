// #975 — il menu che un sito ha per il tasto destro: l'elenco dei siti dove il tasto destro è del sito, il conto delle
// scelte che porta alla proposta (una volta sola), e il ritaglio dell'elenco verso i frame dei siti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const M = require(join(ROOT, 'src', 'main', 'services', 'menuDelSito.js'));
const W = require(join(ROOT, 'src', 'main', 'services', 'impostazioniPerOrigine.js'));
const S = require(join(ROOT, 'src', 'preload', 'menu-del-sito.js'));

test('il sito è l\'host senza www, solo per le pagine web', () => {
  assert.equal(M.sitoDi('https://www.Figma.com/file/x'), 'figma.com');
  assert.equal(M.sitoDi('https://docs.google.com/document/d/1'), 'docs.google.com');
  assert.equal(M.sitoDi('filo://preferences/preferences.html'), '');
  assert.equal(M.sitoDi('non un indirizzo'), '');
});

test('dare il tasto destro al sito aggiunge una voce sola; toglierlo toglie ogni voce che lo copre', () => {
  assert.deepEqual(M.elencoDopo([], 'docs.google.com', true), ['docs.google.com']);
  assert.deepEqual(M.elencoDopo(['docs.google.com'], 'docs.google.com', true), ['docs.google.com']);
  assert.deepEqual(M.elencoDopo(['google.com'], 'docs.google.com', true), ['google.com']);
  assert.deepEqual(M.elencoDopo(['google.com', 'figma.com'], 'docs.google.com', false), ['figma.com']);
  assert.deepEqual(M.elencoDopo(['figma.com'], 'docs.google.com', false), ['figma.com']);
  assert.deepEqual(M.elencoDopo(null, 'figma.com', false), []);
  assert.equal(M.copre('google.com', 'notgoogle.com'), false);
});

test('la proposta arriva alla terza scelta, una volta sola, e mai dove il tasto destro è già del sito', () => {
  let scelte = {};
  const esiti = [];
  for (let i = 0; i < 5; i++) {
    const r = M.conta(scelte, 'figma.com', { ora: 1000 + i });
    scelte = r.scelte;
    esiti.push(r.proponi);
  }
  assert.deepEqual(esiti, [false, false, true, false, false]);
  assert.equal(scelte['figma.com'].n, 5);
  assert.equal(scelte['figma.com'].proposto, true);

  let altro = {};
  for (let i = 0; i < 4; i++) {
    const r = M.conta(altro, 'docs.google.com', { primo: true });
    altro = r.scelte;
    assert.equal(r.proponi, false);
  }
});

test('il conto delle scelte ha un tetto: oltre, se ne vanno le più vecchie e restano le nuove', () => {
  const tante = {};
  for (let i = 0; i < M.TETTO_SITI; i++) tante[`s${i}.example`] = { n: 1, proposto: false, alle: i };
  const r = M.conta(tante, 'nuovo.example', { ora: M.TETTO_SITI + 10 });
  assert.equal(Object.keys(r.scelte).length, M.TETTO_SITI);
  assert.ok(r.scelte['nuovo.example']);
  assert.equal(r.scelte['s0.example'], undefined);
});

test('a un frame arriva solo la voce dell\'elenco che riguarda il suo sito o la sua scheda', () => {
  const settings = { menuDelSito: ['docs.google.com', 'figma.com', 'segreto.example'], blocklist: [] };
  const out = W.impostazioniPerWeb(settings, ['https://docs.google.com/document/d/1', 'https://docs.google.com/document/d/1']);
  assert.deepEqual(out.menuDelSito, ['docs.google.com']);
  const fuori = W.impostazioniPerWeb(settings, ['https://altro.example/']);
  assert.deepEqual(fuori.menuDelSito, []);
});

test('la sonda per il mondo della pagina è codice valido e porta il nome segreto che le si dà', () => {
  const src = S.sorgenteSonda('filo-menu-abc123');
  assert.doesNotThrow(() => new Function(src));
  assert.ok(src.includes('"filo-menu-abc123"'));
  // Nessun nome fisso che la pagina possa ascoltare per fingere di avere un menu.
  assert.ok(!/addEventListener\(['"]filo/.test(src));
});

test('la copia del tasto destro tiene l\'elemento vero e i dati che il menu legge', () => {
  const nodo = { id: 'n' };
  const c = S.fotografa({ composedPath: () => [nodo], target: { id: 'host' }, clientX: 10, clientY: 20, shiftKey: true });
  assert.equal(c.target, nodo);
  assert.deepEqual(c.composedPath(), [nodo]);
  assert.equal(c.clientX, 10);
  assert.equal(c.shiftKey, true);
});
