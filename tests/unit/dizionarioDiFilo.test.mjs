// #1585 — il dizionario del correttore è di Filo, lo stesso su Windows, Mac e Linux: su Windows il browser lascia
// l'italiano al sistema e alla pagina dice «giusta» a ogni parola. Questo file gira anche nel lavoro Windows della suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const MODULO = require.resolve('../../src/main/services/dizionarioDiFilo.js');

// Lo stato del dizionario è uno per processo, come nell'app: ogni prova ne carica uno suo.
function nuovo() {
  delete require.cache[MODULO];
  return require(MODULO);
}

const pronti = new Map();
async function dizionario(locale) {
  if (!pronti.has(locale)) {
    const D = nuovo();
    assert.equal(await D.prepara({ locale }), true, JSON.stringify(D.stato()));
    pronti.set(locale, D);
  }
  return pronti.get(locale);
}

test('una parola sbagliata solo in italiano: «andatto» sì, «andato» no', async () => {
  const D = await dizionario('it-IT');
  assert.deepEqual(D.stato().lingue, ['it-IT']);
  assert.deepEqual(D.sbagliate(['andatto', 'andato', 'quseta', 'questa', 'qzxwvkjh']), [true, false, true, false, true]);
  assert.ok(D.proposte('andatto').includes('andato'), JSON.stringify(D.proposte('andatto')));
  assert.deepEqual(D.proposte('andato'), []);
});

test('accenti, apostrofi, maiuscole e le parole che Chromium aggiunge al suo dizionario', async () => {
  const D = await dizionario('it-IT');
  const giuste = ['perché', 'caffè', 'Perché', 'PERCHÉ', 'più', 'città', "l'albero", "dell'anno", "po'", 'Andato', 'ANDATO',
    'mangiarsela', 'Roma', 'Wikipedia', 'e-mail'];
  assert.deepEqual(giuste.filter((p) => D.sbagliate([p])[0]), []);
  assert.deepEqual(D.sbagliate(['perche', 'roma', 'citta']), [true, true, true]);
  assert.ok(D.proposte('perche').includes('perché'), 'le lettere accentate passano intere nelle proposte');
});

test('i limiti di Chromium: oltre 64 byte la parola non si controlla, oltre 24 niente proposte, al più cinque', async () => {
  const D = await dizionario('it-IT');
  assert.deepEqual(D.sbagliate(['x'.repeat(65), 'è'.repeat(33), '', '   ']), [false, false, false, false]);
  assert.deepEqual(D.proposte('precipitevolissimevolmentt'), []);
  assert.ok(D.proposte('funzion').length <= 5);
  assert.ok(D.proposte('funzion').includes('funzione'));
});

test('richieste storte: niente eccezioni, niente verdetti inventati', async () => {
  const D = await dizionario('it-IT');
  assert.equal(D.sbagliate('andatto'), null);
  assert.equal(D.sbagliate(null), null);
  assert.equal(D.sbagliate(Array(20001).fill('a')), null, 'più di quante il correttore ne ricordi');
  assert.deepEqual(D.sbagliate([42, null, { a: 1 }, '<b>andatto</b>']), [false, false, false, true]);
  assert.deepEqual(D.proposte(null), []);
});

test('finché non è pronto risponde «non so», e una domanda fa partire il caricamento atteso', async () => {
  const D = nuovo();
  assert.equal(D.prepara({ locale: 'it-IT', dopoMs: 60_000 }), null);
  assert.equal(D.sbagliate(['andatto']), null);
  assert.equal(D.proposte('andatto'), null);
  assert.equal(D.stato().fase, 'in caricamento', 'la domanda non aspetta il minuto');
  assert.equal(await D.prepara(), true);
  assert.deepEqual(D.sbagliate(['andatto']), [true]);
});

test('le lingue sono quelle del correttore del browser fra quelle che Filo ha: italiano sempre, l\'inglese di sistema', () => {
  const D = nuovo();
  assert.deepEqual(D.LINGUE, ['en-GB', 'en-US', 'it-IT']);
  assert.deepEqual(D.scegli('it-IT'), ['it-IT']);
  assert.deepEqual(D.scegli('en-US'), ['it-IT', 'en-US']);
  assert.deepEqual(D.scegli('en-AU'), ['it-IT', 'en-GB']);
  assert.deepEqual(D.scegli('de-DE'), ['it-IT']);
  assert.deepEqual(D.scegli(''), ['it-IT']);
});

test('con l\'inglese di sistema una parola è sbagliata solo se nessuna delle due lingue la conosce', async () => {
  const D = await dizionario('en-US');
  assert.deepEqual(D.stato().lingue, ['it-IT', 'en-US']);
  assert.deepEqual(D.sbagliate(['house', 'andato', 'andatto', 'housse']), [false, false, true, true]);
  const p = D.proposte('housse');
  assert.ok(p.includes('house'), JSON.stringify(p));
  assert.equal(new Set(p).size, p.length, 'nessun doppione fra le lingue');
});

test('i file italiani restano Latin-9 con CRLF (GPL, com\'erano): la conversione li legge giusti', () => {
  const D = nuovo();
  const crudo = readFileSync(fileURLToPath(new URL('../../assets/dizionari/sorgenti/it_IT.aff', import.meta.url)));
  assert.match(crudo.toString('latin1'), /^SET ISO8859-15\r$/m);
  assert.equal(D.decodifica(Buffer.from([0xa4, 0xe8, 0x0d, 0x0a, 0xbd]), 'ISO8859-15'), '€è\nœ');
  assert.equal(D.decodifica(Buffer.from('﻿caffè\r\n', 'utf8'), 'UTF-8'), 'caffè\n');
  assert.throws(() => D.decodifica(Buffer.from('x'), 'KOI8-R'), /codifica/);
  const { aff, dic } = D.testiDi('it-IT');
  assert.match(aff, /^SET UTF-8$/m);
  assert.ok(!aff.includes('\r') && !dic.includes('\r'));
  assert.match(dic, /^perché\//m);
  assert.match(dic, /^Wikipedia$/m, 'il delta di Chromium è dentro');
});
