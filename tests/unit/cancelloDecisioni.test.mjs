// Il classificatore passa dal cancello dei modelli come ogni chiamata (#1118): limite di spesa, segreti oscurati,
// costo registrato. Ma una ricerca sono cento richieste: il conto si registra UNA volta per giro, e la catena
// ripiega sul modello dopo solo se quello prima non ha mai risposto.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const memoria = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => ({ [k]: memoria[k] }),
      set: async (o) => { Object.assign(memoria, JSON.parse(JSON.stringify(o))); },
    },
  },
};

require('../../src/shared/constants.js');
require('../../src/shared/guardianoStatico.js');
require('../../src/shared/codaAdattiva.js');
require('../../src/main/services/costTracker.js');
require('../../src/main/services/modelGate.js');

const { ACTIONS, STORAGE_KEYS } = globalThis.SN_CONST;
const Costs = globalThis.SN_COSTS;
const GATE = globalThis.SN_MODEL_GATE;
const AZIONE = ACTIONS.MANAGE_SEARCH_CLASSIFY;
const SEGRETO = 'sk-or-v1-segretissimo0123456789';

let impostazioni;
let viste;
let rispondi;
let registrazioni;

function fornitore(nome) {
  return {
    decisions: async (args) => {
      viste.push({ nome, ...args });
      return rispondi(args, nome);
    },
  };
}

function cancello(catena) {
  globalThis.SN_PROVIDERS = { getProvider: (n) => (n === 'openrouter' || n === 'altro' ? fornitore(n) : null) };
  const costi = {
    ...Costs,
    record: async (r) => { registrazioni.push(r); return Costs.record(r); },
  };
  return GATE.create({
    getSettings: async () => impostazioni,
    buildChain: () => catena.map((a) => ({ ...a })),
    modelFor: () => 'jev',
    costs: costi,
    segreti: async () => [SEGRETO],
  });
}

const richieste = (n) => Array.from({ length: n }, (_, i) => ({ state: { ricerca: 'x' }, questions: { f1: { type: 'noul', instructions: `feedback ${i}` } } }));
const UNO = [{ provider: 'openrouter', apiKey: 'k', model: 'typesafe/jev-1.13' }];

beforeEach(() => {
  delete memoria[STORAGE_KEYS.COSTS];
  impostazioni = { monthlyLimitEur: 5, usdToEur: 1, pricing: {}, excludedProviders: [] };
  viste = [];
  registrazioni = [];
  rispondi = () => ({ answers: { f1: { type: 'noul', noul: 0.9 } }, usage: { promptTokens: 100, completionTokens: 0, costUsd: 0.001, keySource: 'own' } });
});

test('cento richieste, un solo conto: la somma di quello che il router ha detto', async () => {
  const risposte = [];
  const r = await cancello(UNO).decideAll({
    action: AZIONE, requests: richieste(100), parallel: 8,
    onAnswer: (i, answers) => risposte.push([i, answers.f1.noul]),
  });
  assert.equal(viste.length, 100);
  assert.equal(risposte.length, 100);
  assert.equal(r.answered, 100);
  assert.equal(registrazioni.length, 1, 'un conto per giro, non uno per richiesta');
  assert.equal(registrazioni[0].action, AZIONE);
  assert.ok(Math.abs(registrazioni[0].usage.costUsd - 0.1) < 1e-9);
  assert.equal(registrazioni[0].usage.promptTokens, 10000);
  assert.equal(registrazioni[0].usage.keySource, 'own');
  assert.ok(Math.abs(((await Costs.getMonthly()).byAction[AZIONE] || 0) - 0.1) < 1e-9);
});

test('oltre il limite di spesa non parte niente', async () => {
  impostazioni.monthlyLimitEur = 1;
  await Costs.record({ action: ACTIONS.FILO_CHAT, provider: 'openrouter', model: 'x', usage: { costUsd: 2 }, usdToEur: 1 });
  await assert.rejects(cancello(UNO).decideAll({ action: AZIONE, requests: richieste(3) }), { code: 'LIMIT_REACHED' });
  assert.equal(viste.length, 0);
});

test('i segreti custoditi non arrivano al classificatore, né nello stato né nelle domande', async () => {
  await cancello(UNO).decideAll({
    action: AZIONE,
    requests: [{ state: { ricerca: `cerco ${SEGRETO}` }, questions: { f1: { type: 'noul', instructions: `testo con ${SEGRETO}` } } }],
  });
  const inviato = JSON.stringify({ s: viste[0].state, q: viste[0].questions });
  assert.ok(!inviato.includes(SEGRETO), inviato);
});

test('un modello che non ha mai risposto lascia il posto al prossimo della catena; uno che ha risposto no', async () => {
  const catena = [
    { provider: 'openrouter', apiKey: 'k', model: 'vendor/non-classifica' },
    { provider: 'altro', apiKey: 'k2', model: 'typesafe/jev-1.13' },
  ];
  rispondi = (args) => {
    if (args.model === 'vendor/non-classifica') throw Object.assign(new Error('OpenRouter 400: not a decisions model'), { status: 400, provider: 'openrouter' });
    return { answers: { f1: { noul: 0.7 } }, usage: { costUsd: 0.002 } };
  };
  const r = await cancello(catena).decideAll({ action: AZIONE, requests: richieste(10), parallel: 4 });
  assert.equal(r.model, 'typesafe/jev-1.13');
  assert.equal(r.answered, 10);
  assert.equal(registrazioni.length, 1, 'il modello che ha solo rifiutato non ha speso niente');

  // Dopo la prima risposta un 400 è di quella richiesta: si salta, il resto continua.
  viste = []; registrazioni = [];
  let n = 0;
  rispondi = () => {
    n++;
    if (n === 3) throw Object.assign(new Error('OpenRouter 400: troppo lungo'), { status: 400 });
    return { answers: { f1: { noul: 0.1 } }, usage: { costUsd: 0.001 } };
  };
  const r2 = await cancello(UNO).decideAll({ action: AZIONE, requests: richieste(6), parallel: 1 });
  assert.equal(r2.answered, 5);
  assert.deepEqual(r2.skipped, [2]);
  assert.equal(r2.error, null);
});

test('nessun modello della catena risponde: l\'errore risale', async () => {
  rispondi = () => { throw Object.assign(new Error('OpenRouter 401: chiave'), { status: 401, provider: 'openrouter' }); };
  await assert.rejects(cancello(UNO).decideAll({ action: AZIONE, requests: richieste(4) }), (e) => e.status === 401);
  assert.equal(registrazioni.length, 0);
});

test('prima della prima risposta un guasto passeggero ha un solo tentativo in più, ad attesa corta: un servizio giù ripiega presto', async () => {
  for (const errore of [
    Object.assign(new Error('OpenRouter 503: upstream'), { status: 503 }),
    new TypeError('fetch failed'),
  ]) {
    viste = [];
    rispondi = () => { throw errore; };
    const t0 = Date.now();
    await assert.rejects(cancello(UNO).decideAll({ action: AZIONE, requests: richieste(10), parallel: 2 }));
    assert.ok(Date.now() - t0 < 4000, `${errore.message}: ${Date.now() - t0} ms`);
    assert.ok(viste.length <= 4, `${errore.message}: ${viste.length} chiamate`);
  }
});

test('troppe richieste alla prima ondata: si aspetta e si riprova, e risponde il classificatore', async () => {
  viste = [];
  let n = 0;
  rispondi = () => {
    n++;
    if (n <= 2) throw Object.assign(new Error('OpenRouter 429: piano'), { status: 429, retryAfterMs: 50 });
    return { answers: { f1: { noul: 0.1 } }, usage: { costUsd: 0.001 } };
  };
  const r = await cancello(UNO).decideAll({ action: AZIONE, requests: richieste(6), parallel: 2 });
  assert.equal(r.answered, 6);
  assert.equal(r.error, null);
});

test('troppe richieste per i primi secondi, con o senza attesa chiesta: si aspetta quanto chiede e risponde il classificatore', async () => {
  const FINESTRA_PIANO_MS = 1800;
  for (const retryAfterMs of [FINESTRA_PIANO_MS, undefined]) {
    viste = [];
    // Il servizio rifiuta finché non scade il suo timer, più lungo dell'attesa corta del ripiego svelto.
    let aperto = false;
    setTimeout(() => { aperto = true; }, FINESTRA_PIANO_MS);
    rispondi = () => {
      if (!aperto) throw Object.assign(new Error('OpenRouter 429: piano'), { status: 429, retryAfterMs });
      return { answers: { f1: { noul: 0.1 } }, usage: { costUsd: 0.001 } };
    };
    const r = await cancello(UNO).decideAll({ action: AZIONE, requests: richieste(3), parallel: 3 });
    assert.equal(r.answered, 3, `attesa chiesta ${retryAfterMs}`);
    assert.equal(r.error, null);
  }
});

test('una richiesta che cade due volte mentre le altre sono ancora in volo non ferma il giro', async () => {
  viste = [];
  let n = 0;
  let sblocca;
  const secondaCaduta = new Promise((ok) => { sblocca = ok; });
  rispondi = async () => {
    n++;
    if (n === 1) throw Object.assign(new Error('OpenRouter 502: upstream'), { status: 502 });
    if (n === 4) { sblocca(); throw Object.assign(new Error('OpenRouter 502: upstream'), { status: 502 }); }
    await secondaCaduta;
    return { answers: { f1: { noul: 0.1 } }, usage: { costUsd: 0.001 } };
  };
  const r = await cancello(UNO).decideAll({ action: AZIONE, requests: richieste(6), parallel: 3 });
  assert.equal(r.answered, 6);
  assert.equal(r.error, null);
});

test('dopo la prima risposta un guasto passeggero si ritenta', async () => {
  viste = [];
  let n = 0;
  rispondi = () => {
    n++;
    if (n === 2) throw Object.assign(new Error('OpenRouter 503: upstream'), { status: 503 });
    return { answers: { f1: { noul: 0.1 } }, usage: { costUsd: 0.001 } };
  };
  const r = await cancello(UNO).decideAll({ action: AZIONE, requests: richieste(4), parallel: 1 });
  assert.equal(r.answered, 4);
  assert.equal(r.error, null);
});

test('la chiamata al classificatore è fra quelle che il cancello conosce', () => {
  assert.ok(GATE.PAID.has('decisions'));
});
