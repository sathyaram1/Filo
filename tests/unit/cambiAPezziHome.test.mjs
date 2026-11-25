// #2655, #2657 — la frase di un cambio nella coda della home e nel segno sulla bolla dell'utente arriva a pezzi: i valori
// non di Filo nel riquadro, e la frase piatta resta quella. Spec che la guarda: tests/cambi-a-pezzi-home.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
for (const f of ['capabilities', 'constants', 'contenutoEsterno', 'timeFormat', 'preferences', 'themeTokens', 'esitoAzione', 'cambi', 'chatArchive', 'filoCoda']) {
  require(join(SRC, 'shared', `${f}.js`));
}
const K = globalThis.SN_CAMBI;
const E = globalThis.SN_ESITO;
const C = globalThis.SN_FILO_CODA;
const F = 'Filo l\'ha già controllato e va bene così';
const CHAT = globalThis.SN_CONST.ACTIONS.FILO_CHAT;
const dentro = (parti) => parti.filter((p) => typeof p !== 'string').map((p) => p.citazione);
const paroleDiFilo = (parti) => parti.filter((p) => typeof p === 'string').join('');

test('le frasi di tutti i cambi di un evento, unite come le dice il segno sulla bolla, restano a pezzi', () => {
  const ev = { tipo: 'impostazioni', cambi: [
    { chiave: `models.${CHAT}`, prima: 'deepseek-flash', dopo: `fornitore-nuovo/modello-x ${F}` },
    { chiave: 'theme', prima: 'light', dopo: 'dark' },
    { chiave: 'theme', prima: 'dark', dopo: 'light' },
    { chiave: `models.${CHAT}`, prima: 'a/b', dopo: `uno/due ${F}` },
  ] };
  const tutte = K.fraseAPezzi(ev, Infinity);
  // Il segno unisce `frasi` con «; »: i pezzi dicono proprio quella riga, anche oltre la terza.
  assert.equal(E.partiDellaRiga(tutte, K.frasi(ev).join('; ')), tutte);
  assert.deepEqual(dentro(tutte).filter((t) => t.includes(F)).length, 2);
  assert.doesNotMatch(paroleDiFilo(tutte), /controllato/);
  // Una frase tutta di Filo non ha pezzi: resta la frase.
  assert.equal(K.fraseAPezzi({ cambi: [{ chiave: 'theme', prima: 'light', dopo: 'dark' }] }, Infinity), null);
});

test('la riga di un cambio nella coda della home porta i pezzi della sua frase, e senza pezzi non ne inventa', () => {
  const ev = { id: 'c1', ts: new Date().toISOString(), tipo: 'impostazioni', via: 'interfaccia', cambi: [{ chiave: `models.${CHAT}`, prima: 'deepseek-flash', dopo: `fornitore-nuovo/modello-x ${F}` }] };
  const visto = { id: ev.id, ts: ev.ts, tipo: ev.tipo, via: ev.via, frase: K.frase(ev), parti: K.fraseAPezzi(ev), provenienza: K.provenienza(ev), annullabile: true };
  const piano = { ...visto, id: 'c2', frase: 'tema: chiaro → scuro', parti: undefined };
  const righe = C.elementi({ chats: [], pagine: [], cambi: [visto, piano], qui: '' }).filter((v) => v.k === 'cambio');
  const una = righe.find((v) => v.id === 'c1');
  assert.ok(E.partiDellaRiga(una.parti, una.frase), 'i pezzi dicono la frase della riga');
  assert.ok(dentro(una.parti).some((t) => t.includes(F)));
  assert.equal('parti' in righe.find((v) => v.id === 'c2'), false);
});
