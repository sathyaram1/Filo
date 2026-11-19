// Verifica #2369 giro 1: con pochi scambi vecchi (o senza modello d'indicizzazione e poche conversazioni) decide la
// prova per parole, e due parole comuni condivise («scrivi», «aprirne») bastano a ripescare uno scambio fuori tema.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import '../../../src/shared/capabilities.js';
import '../../../src/shared/constants.js';
import '../../../src/shared/contenutoEsterno.js';
import '../../../src/shared/chatArchive.js';
import '../../../src/shared/filoContesto.js';

const require = createRequire(import.meta.url);
globalThis.chrome = globalThis.chrome || { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };
const Ricordi = require('../../../src/main/services/ricordiFilo.js');

const DOMANDA = 'ok apri il feedback. scrivi tutto su ctrl.\n\nsulla colonna se non era chiaro da quello precedente sul tema aprirne un altro con l\'aggiunta.\n\npoi domani riordino i feedback con opus.';
const SCAMBI = [
  ['Geber', 'mettici solo la strada di Geber; wikipedia', 0.31],
  ['Mail', 'scrivi una mail a Marco per la cena, poi aprirne un\'altra per Luca', 0.33],
  ['Meteo', 'che tempo fa domani a Milano', 0.3],
  ['Carbonara', 'come si fa la carbonara?', 0.32],
  ['Lisbona', 'cercami voli per Lisbona a marzo', 0.29],
];

const cartelle = [];
test.afterAll(() => { for (const c of cartelle) togliCartella(c); });

function prepara(conVettori) {
  const cartella = cartellaTemporanea('verifica-2369-');
  cartelle.push(cartella);
  globalThis.SN_IL_FILO = { percorso: () => path.join(cartella, 'filo.jsonl') };
  Ricordi.azzera();
  const posto = (testo) => SCAMBI.findIndex(([titolo]) => testo.startsWith(`${titolo}\n`)) + 1;
  Ricordi.collega({
    vettori: async (testi) => (conVettori ? { model: 'qwen/qwen3-embedding-8b', vectors: testi.map((t) => [posto(t)]) } : null),
    quantizza: (v) => v,
    coseno: (_a, b) => (b[0] > 0 ? SCAMBI[b[0] - 1][2] : 1),
  });
  const vecchi = [];
  SCAMBI.forEach(([titolo, testo], i) => {
    const ts = new Date(Date.UTC(2026, 9, 1 + i, 10)).toISOString();
    vecchi.push({ chat: `c${i}`, titolo, role: 'user', text: testo, ts });
    vecchi.push({ chat: `c${i}`, titolo, role: 'filo', text: 'Fatto.', ts: new Date(Date.parse(ts) + 60000).toISOString() });
  });
  return vecchi;
}

test('r1 con cinque scambi vecchi, tutti lontani per vettori, la domanda dello screenshot non ripesca niente', async () => {
  const presi = await Ricordi.cerca(DOMANDA, { vecchi: prepara(true) });
  expect(presi.map((p) => p.tratto.titolo)).toEqual([]);
});

test('r1 senza modello d\'indicizzazione e con poche conversazioni, la domanda dello screenshot non ripesca la mail', async () => {
  const presi = await Ricordi.cerca(DOMANDA, { vecchi: prepara(false) });
  expect(presi.map((p) => p.tratto.titolo)).toEqual([]);
});
