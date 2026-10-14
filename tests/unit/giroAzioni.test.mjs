// #1097.2 — le letture di uno stesso giro della chat partono insieme, e si controllano contro quello che il modello aveva
// davanti a inizio giro: un documento letto in un giro prima resta, e la ricerca che ne porta fuori un pezzo chiede l'OK.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['cmdClassify', 'actionLevels', 'guardianoStatico', 'urlExfil']) require(join(ROOT, 'src', 'shared', `${f}.js`));
const { eseguiGiro } = require(join(ROOT, 'src', 'main', 'services', 'giroAzioni.js'));
const L = globalThis.SN_ACTION_LEVELS;
const X = globalThis.SN_URL_EXFIL;

const DOC_DI_PRIMA = {
  type: 'LEGGI_DOCUMENTO', percorso: 'contratto.txt',
  _output: { documentRead: 'contratto.txt', text: 'Contratto di locazione. Inquilino Mario Rossi, canone mensile 740 euro, scadenza 2027.' },
};
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// Come il dispatch: la porta delle uscite prima del livello, il livello dal registro, poi l'esito.
function finto({ durate = {} } = {}) {
  const diario = [];
  const avvia = async (a, { contesto }) => {
    diario.push(`parte ${a.id}`);
    const v = X.valutaUscita(a, { azioni: contesto });
    if (v.exfil) a._exfil = true;
    await pausa(durate[a.id] ?? 20);
    diario.push(`finisce ${a.id}`);
    const costo = L.costoFor(a);
    if (costo >= 2) return { executed: false, kept: true, needsConfirm: costo };
    return { executed: true, kept: true, output: a.type === 'LEGGI_DOCUMENTO' ? { text: 'Un altro documento.' } : { results: [{ title: 'x' }] } };
  };
  return { diario, avvia };
}
const opzioni = (extra) => ({
  fonti: [],
  apertura: (a) => a.type === 'NAVIGA',
  lettura: (a) => L.diSolaLettura(a.type),
  ...extra,
});

test('documento letto un giro prima + ricerca che ne porta fuori un pezzo nella stessa partita: l\'OK resta chiesto', async () => {
  const contesto = [DOC_DI_PRIMA];
  const { diario, avvia } = finto({ durate: { doc: 60, web: 10 } });
  const esiti = [];
  const azioni = [
    { id: 'doc', type: 'LEGGI_DOCUMENTO', percorso: 'altro.txt' },
    { id: 'web', type: 'CERCA_WEB', query: 'canone mensile 740 euro contratto Mario Rossi' },
  ];
  await eseguiGiro(azioni, opzioni({
    contesto, avvia,
    dopo: (a, res) => { esiti.push([a.id, res]); contesto.push({ ...a, _output: res.output }); },
  }));
  assert.deepEqual(diario.slice(0, 2), ['parte doc', 'parte web'], 'le due letture partono insieme');
  assert.deepEqual(esiti.map(([id]) => id), ['doc', 'web'], 'gli esiti arrivano nell\'ordine del modello');
  assert.equal(esiti[1][1].needsConfirm, 2, 'la ricerca chiede ancora l\'OK');
});

test('due ricerche dello stesso giro vanno insieme: il giro dura quanto la più lunga, non la somma', async () => {
  const { diario, avvia } = finto({ durate: { a: 250, b: 250 } });
  const t0 = Date.now();
  await eseguiGiro([{ id: 'a', type: 'CERCA_WEB', query: 'treni Milano' }, { id: 'b', type: 'CERCA_WEB', query: 'meteo Roma' }],
    opzioni({ contesto: [], avvia, dopo: () => {} }));
  assert.deepEqual(diario.slice(0, 2), ['parte a', 'parte b']);
  assert.ok(Date.now() - t0 < 450, `durata ${Date.now() - t0} ms`);
});

test('una lettura dopo un\'azione che cambia qualcosa aspetta il suo esito', async () => {
  const { diario, avvia } = finto();
  await eseguiGiro([
    { id: 'web', type: 'CERCA_WEB', query: 'tema scuro' },
    { id: 'imposta', type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' },
    { id: 'rileggi', type: 'LEGGI_IMPOSTAZIONI', cerca: 'tema' },
  ], opzioni({ contesto: [], avvia, dopo: () => {} }));
  assert.ok(diario.indexOf('parte rileggi') > diario.indexOf('finisce imposta'), diario.join(', '));
});

test('fermato dall\'utente: le azioni non ancora partite non partono, quelle partite finiscono e si raccontano', async () => {
  const { diario, avvia } = finto();
  let fermo = false;
  const consegnate = [];
  const r = await eseguiGiro([
    { id: 'w1', type: 'CERCA_WEB', query: 'uno' },
    { id: 'w2', type: 'CERCA_WEB', query: 'due' },
    { id: 'imposta', type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' },
  ], opzioni({ contesto: [], avvia, fermo: () => fermo, dopo: (a) => { consegnate.push(a.id); fermo = true; } }));
  assert.equal(r.fermato, true);
  assert.deepEqual(consegnate, ['w1', 'w2']);
  assert.ok(!diario.includes('parte imposta'));
});

test('le letture del giro sono quelle del registro', () => {
  for (const t of L.LETTURE) {
    assert.ok(L.REGISTRY[t], `${t} sta nel registro`);
    assert.equal(L.costoFor({ type: t }), 0, `${t} senza contesto è una lettura libera`);
  }
  for (const t of ['NAVIGA', 'IMPOSTA_PREFERENZA', 'ESEGUI_COMANDO', 'SALVA_APPUNTO']) assert.equal(L.diSolaLettura(t), false, t);
});
