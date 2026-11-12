// Unit test per src/shared/elencoScaricamenti.js (#2307): una lista di risposta più vecchia degli eventi già arrivati
// non riporta indietro le righe del pannello. Il numero lo dà il main: la seconda parte lo prova su downloads.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'elencoScaricamenti.js'));
const E = globalThis.SN_ELENCO_SCARICAMENTI;

const voce = (id, state, rev) => ({ id, state, rev });
const stati = (s) => Object.fromEntries(Array.from(s.voci, ([id, v]) => [id, v.state]));

test('la risposta fotografata prima della fine non riporta la riga «in corso» (il caso di #2307)', () => {
  const s = E.crea();
  E.evento(s, 'start', voce('a', 'pending', 1));
  // Il sì: il main fotografa l'elenco (rev 2), poi la voce finisce (rev 3) e l'evento arriva prima della risposta.
  E.evento(s, 'done', voce('a', 'completed', 3));
  assert.equal(E.lista(s, { items: [voce('a', 'progressing', 2)], rev: 2 }), true);
  assert.deepEqual(stati(s), { a: 'completed' });
});

test('una lista più nuova vince: porta i cambi che nessun evento ha detto', () => {
  const s = E.crea();
  E.evento(s, 'progress', voce('a', 'progressing', 4));
  E.lista(s, { items: [Object.assign(voce('a', 'completed', 4), { missing: true })], rev: 6 });
  assert.equal(s.voci.get('a').missing, true);
});

test('una voce nata dopo la foto resta, una sparita prima della foto se ne va', () => {
  const s = E.crea();
  E.evento(s, 'start', voce('vecchia', 'completed', 2));
  E.evento(s, 'start', voce('nuova', 'pending', 8));
  E.lista(s, { items: [], rev: 5 });
  assert.deepEqual(stati(s), { nuova: 'pending' });
});

test('una voce tolta dopo la foto non torna con la lista vecchia', () => {
  const s = E.crea();
  E.evento(s, 'done', voce('a', 'completed', 3));
  E.evento(s, 'removed', voce('a', 'completed', 7));
  E.lista(s, { items: [voce('a', 'completed', 3)], rev: 6 });
  assert.deepEqual(stati(s), {});
  // Una lista più nuova della rimozione la sa già: il segno si scorda.
  E.lista(s, { items: [], rev: 9 });
  assert.equal(s.tolte.size, 0);
});

test('una lista più vecchia di una già applicata non tocca niente (Svuota toglie senza eventi)', () => {
  const s = E.crea();
  E.lista(s, { items: [voce('a', 'completed', 2), voce('b', 'completed', 3)], rev: 3 });
  E.lista(s, { items: [], rev: 4 });
  assert.equal(E.lista(s, { items: [voce('a', 'completed', 2), voce('b', 'completed', 3)], rev: 3 }), false);
  assert.deepEqual(stati(s), {});
});

test('un evento più vecchio della voce in mano non la riscrive; la mappa resta quella data', () => {
  const dls = new Map();
  const s = E.crea(dls);
  E.evento(s, 'done', voce('a', 'completed', 5));
  E.evento(s, 'progress', voce('a', 'progressing', 4));
  assert.equal(dls.get('a').state, 'completed');
  E.lista(s, { items: [voce('b', 'completed', 6)], rev: 6 });
  assert.equal(s.voci, dls);
  assert.deepEqual(Array.from(dls.keys()), ['b']);
});

test('il main numera ogni cambio visto dalle superfici e lo mette nelle risposte, mai su disco', async () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(join(ROOT, 'src', 'main', 'services', 'downloads.js'), 'utf8');
  // Ogni risposta con l'elenco passa da elenco(): items senza numero tornerebbero a riscrivere gli eventi.
  assert.deepEqual(src.match(/items:\s*listRecords\([^)]*\)[^}]*/g), ['items: listRecords(scope), rev: revisione '],
    'una risposta con items: listRecords( senza il numero');
  assert.match(src, /rec\._rev = \+\+revisione/);
  assert.match(src, /map\(\(\{ velocita, restano, rev, \.\.\.r \}\) => r\)/);
  const misc = fs.readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers', 'misc.js'), 'utf8');
  assert.equal(/items:\s*DL\(\)\./.test(misc), false, 'un handler dei download risponde items senza il numero');
  const html = fs.readFileSync(join(ROOT, 'src', 'renderer', 'shell.html'), 'utf8');
  assert.ok(html.indexOf('elencoScaricamenti.js') > 0 && html.indexOf('elencoScaricamenti.js') < html.indexOf('shell/shell.js'));
});
