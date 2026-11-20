// Il ricordo per vettori (#2369): vale solo lo scambio che si stacca dalla mediana della domanda, un saluto non
// ripesca niente, con pochi confronti decide la prova per parole. I coseni sono quelli misurati col modello di serie:
// patterns/il-ricordo-si-stacca-dal-rumore.md.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import '../../src/shared/capabilities.js';
import '../../src/shared/constants.js';
import '../../src/shared/contenutoEsterno.js';
import '../../src/shared/chatArchive.js';
import '../../src/shared/filoContesto.js';

const require = createRequire(import.meta.url);
globalThis.chrome = globalThis.chrome || { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };
const Ricordi = require('../../src/main/services/ricordiFilo.js');
const FC = globalThis.SN_FILO_CONTESTO;

const cartelle = [];
after(() => { for (const c of cartelle) togliCartella(c); });

const DOMANDA = 'ok apri il feedback. scrivi tutto su ctrl.\n\nsulla colonna se non era chiaro da quello precedente sul tema aprirne un altro con l\'aggiunta.\n\npoi domani riordino i feedback con opus.';
// Gli scambi vecchi e il coseno di ciascuno con la domanda dello screenshot (qwen3-embedding-8b, 256 dimensioni).
const NESSUNO_CENTRA = [
  ['Geber', 'mettici solo la strada di Geber; wikipedia', 0.31],
  ['Carbonara', 'come si fa la carbonara?', 0.32],
  ['Lisbona', 'cercami voli per Lisbona a marzo', 0.29],
  ['Bolletta', 'quanto ho pagato di luce a ottobre?', 0.29],
  ['Python', 'come ordino una lista di dizionari per chiave in python', 0.38],
  ['Saluti', 'ciao come va', 0.43],
  ['Conferma', 'ok', 0.55],
  ['Mail', 'scrivi a marco che la riunione è lunedì alle 10', 0.53],
  ['Routine', 'quanti feedback ha chiuso la routine stanotte?', 0.55],
  ['Tema', 'il tema scuro ha il testo grigio illeggibile', 0.36],
];
const CENTRA = ['Doppio Ctrl', 'scrivi un feedback: il doppio ctrl deve aprire il box delle lettere', 0.69];

let chiamate = 0;
function prepara(scambi) {
  const cartella = cartellaTemporanea('ricordo-vicinanza-');
  cartelle.push(cartella);
  globalThis.SN_IL_FILO = { percorso: () => path.join(cartella, 'filo.jsonl') };
  Ricordi.azzera();
  chiamate = 0;
  // Il vettore di uno scambio è il suo posto nell'elenco, quello della domanda è 0: il coseno lo legge dalla tabella.
  const posto = (testo) => scambi.findIndex(([titolo]) => testo.startsWith(`${titolo}\n`)) + 1;
  Ricordi.collega({
    vettori: async (testi) => { chiamate++; return { model: 'qwen/qwen3-embedding-8b', vectors: testi.map((t) => [posto(t)]) }; },
    quantizza: (v) => v,
    coseno: (a, b) => (b[0] > 0 ? scambi[b[0] - 1][2] : 1),
  });
  const vecchi = [];
  scambi.forEach(([titolo, testo], i) => {
    const ts = new Date(Date.UTC(2026, 9, 1 + i, 10)).toISOString();
    const fine = new Date(Date.parse(ts) + 60000).toISOString();
    vecchi.push({ chat: `c${i}`, titolo, role: 'user', text: testo, ts });
    vecchi.push({ chat: `c${i}`, titolo, role: 'filo', text: 'Fatto.', ts: fine });
  });
  return vecchi;
}

test('la domanda dello screenshot non ripesca niente quando nessuno scambio c\'entra', async () => {
  const vecchi = prepara(NESSUNO_CENTRA);
  const presi = await Ricordi.cerca(DOMANDA, { vecchi });
  assert.equal(chiamate > 0, true, 'la domanda è passata dai vettori');
  assert.deepEqual(presi.map((p) => p.tratto.titolo), [], 'tre scambi sopra 0,45 ma nessuno che si stacchi dal resto');
});

test('lo scambio che c\'entra si ripesca, da solo', async () => {
  const vecchi = prepara([...NESSUNO_CENTRA, CENTRA]);
  const presi = await Ricordi.cerca(DOMANDA, { vecchi });
  assert.deepEqual(presi.map((p) => p.tratto.titolo), ['Doppio Ctrl']);
  assert.match(presi[0].tratto.testo, /doppio ctrl/);
});

test('un saluto non ripesca niente e non chiede nemmeno i vettori', async () => {
  const vecchi = prepara([...NESSUNO_CENTRA, CENTRA]);
  for (const saluto of ['ciao', 'Ok, grazie mille!', 'perfetto', '  ']) {
    assert.deepEqual(await Ricordi.cerca(saluto, { vecchi }), [], saluto);
  }
  assert.equal(chiamate, 0);
});

test('con meno di otto scambi i vettori non bastano: decide la prova per parole', async () => {
  const pochi = [['Geber', 'mettici solo la strada di Geber; wikipedia', 0.9], ['Lisbona', 'cercami voli per Lisbona a marzo', 0.3]];
  assert.deepEqual(await Ricordi.cerca('apri il feedback sul ctrl', { vecchi: prepara(pochi) }), [], 'vicino per vettori, ma nessuna parola in comune');
  const presi = await Ricordi.cerca('la strada di Geber su wikipedia', { vecchi: prepara(pochi) });
  assert.deepEqual(presi.map((p) => p.tratto.titolo), ['Geber']);
});

test('la regola vale su modelli con scale diverse: conta lo stacco dalla mediana', () => {
  const tratto = (n) => ({ tratto: { titolo: `t${n}`, ts: new Date(Date.UTC(2026, 0, 1 + n)).toISOString() } });
  const con = (scores) => scores.map((score, n) => ({ ...tratto(n), score }));
  // text-embedding-3-small: il giusto sta a 0,58, sotto il rumore più alto di qwen, ma 0,29 sopra la sua mediana.
  const piccolo = FC.ricordiPerVicinanza(con([0.24, 0.19, 0.46, 0.16, 0.58, 0.29, 0.2, 0.32, 0.27, 0.3]));
  assert.deepEqual(piccolo.map((p) => p.tratto.titolo), ['t4']);
  // Tutti alti e vicini fra loro: nessuno si stacca.
  assert.deepEqual(FC.ricordiPerVicinanza(con([0.6, 0.62, 0.58, 0.66, 0.61, 0.59, 0.63, 0.6])), []);
  // Al più tre, in ordine di tempo.
  const tanti = FC.ricordiPerVicinanza(con([0.9, 0.3, 0.88, 0.3, 0.86, 0.3, 0.84, 0.3, 0.3]));
  assert.deepEqual(tanti.map((p) => p.tratto.titolo), ['t0', 't2', 't4']);
  assert.equal(FC.ricordiPerVicinanza(con([0.9, 0.3, 0.3])), null);
});

test('una domanda ha un argomento se ha una parola che distingue e non è di cortesia', () => {
  for (const s of ['ciao', 'ok grazie', 'Grazie mille!', 'sì, perfetto', '']) assert.equal(FC.domandaConArgomento(s), false, s);
  for (const s of [DOMANDA, 'ricetta carbonara', 'IVA', 'fallo']) assert.equal(FC.domandaConArgomento(s), true, s);
});
