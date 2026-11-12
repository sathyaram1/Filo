// #1307.4 — ogni pagina che entra nel filo, cambia titolo o se ne va lo annuncia la scrittura del filo: le home aperte
// rileggono anche quando la visita arriva con loro già davanti. Le chat no: hanno annunci loro.
// Niente Electron: il filo scrive in una cartella temporanea.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import '../../src/shared/filoEventi.js';

const require = createRequire(import.meta.url);
globalThis.SN_CONST = globalThis.SN_CONST || { STORAGE_KEYS: {} };
const { creaFilo } = require('../../src/main/services/ilFilo.js');
const E = globalThis.SN_FILO_EVENTI;

const cartelle = new Set();
after(() => { for (const c of cartelle) togliCartella(c); });

function nuovo() {
  const cartella = cartellaTemporanea('filo-annunci-');
  cartelle.add(cartella);
  const f = creaFilo({ cartella, avvisa: () => {} });
  const annunci = [];
  f.suPagine((o) => annunci.push(o));
  return { f, annunci };
}

test('una visita, il suo titolo e la sua cancellazione si annunciano, a stato già piegato', async () => {
  const { f, annunci } = nuovo();
  const viste = [];
  f.suPagine(() => { viste.push(f.pagine()); });
  const ev = await f.registraVisita({ url: 'https://balene.example/', titolo: 'Caricamento…' });
  assert.deepEqual(annunci, [{ incognito: false }]);
  assert.deepEqual((await viste[0]).map((p) => p.id), [ev.id]);
  await f.aggiornaTitolo({ visita: ev.id, titolo: 'balene' });
  assert.equal(annunci.length, 2);
  assert.equal((await viste[1])[0].titolo, 'balene');
  await f.cancellaVisite([{ ts: ev.ts, sito: 'balene.example', url: 'https://balene.example/' }]);
  assert.equal(annunci.length, 3);
  assert.deepEqual(await viste[2], []);
});

test('una visita nella finestra incognito si annuncia col suo segno; una chat e la sua cancellazione no', async () => {
  const { f, annunci } = nuovo();
  await f.registraVisita({ url: 'https://segreta.example/', titolo: 'Segreta' }, { incognito: true });
  assert.deepEqual(annunci, [{ incognito: true }]);
  await f.transazione((t) => t.scrivi([
    t.evento(E.TIPI.CHAT_APERTA, { chat: 'c1' }),
    t.evento(E.TIPI.MESSAGGIO, { chat: 'c1', msg: { role: 'user', text: 'ciao' } }, { autore: 'utente' }),
  ]));
  await f.transazione((t) => t.scrivi([t.evento(E.TIPI.CANCELLAZIONE, { chat: 'c1' }, { autore: 'utente' })]));
  assert.equal(annunci.length, 1);
});

test('una visita già coperta da una cancellazione non entra e non si annuncia', async () => {
  const { f, annunci } = nuovo();
  const ts = new Date(Date.now() - 60_000).toISOString();
  await f.cancellaVisite([{ ts, sito: 'via.example' }]);
  assert.equal(annunci.length, 1);
  await f.registraVisita({ url: 'https://via.example/', titolo: 'Via', ts });
  assert.equal(annunci.length, 1);
  assert.deepEqual(await f.pagine(), []);
});
