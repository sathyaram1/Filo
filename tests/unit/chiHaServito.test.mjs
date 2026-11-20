// Chi ha servito le ultime richieste dei crediti (#542): la lettura del registro d'uso (src/main/services/chiHaServito.js)
// e i due conti di src/shared/wallet.js che la pagina dei predefiniti mostra accanto ai fornitori esclusi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/politicaModelli.js');
require('../../src/shared/wallet.js');
const W = globalThis.SN_WALLET;
const Lettura = require('../../src/main/services/chiHaServito.js');

const fs = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { stringValue: v }]));
const REST = { FIRESTORE_BASE: 'https://firestore.example/v1/projects/p/databases/(default)/documents', API_KEY: 'k' };

function fintoFetch(risposta, { status = 200 } = {}) {
  const chiamate = [];
  const fetch = async (url, init) => {
    chiamate.push({ url, init, corpo: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status, json: async () => risposta };
  };
  return { fetch, chiamate };
}

test('la lettura chiede al registro d\'uso le ultime righe, coi soli campi che si mostrano, col token dell\'owner', async () => {
  const { fetch, chiamate } = fintoFetch([
    { document: { fields: fs({ at: '2026-11-20T10:00:00.000Z', model: 'qwen/qwen3', servedBy: 'Novita' }) } },
    { document: { fields: fs({ at: '2026-11-20T09:00:00.000Z', model: 'qwen/qwen3', servedBy: 'DeepInfra' }) } },
    { document: { fields: fs({ at: '2026-11-19T08:00:00.000Z', model: 'qwen/qwen3', servedBy: 'Novita' }) } },
    { readTime: '2026-11-20T10:00:01Z' },
  ]);
  const l = Lettura.crea({ fetch, rest: () => REST });
  const r = await l.leggi({ idToken: 'tok' });

  assert.equal(chiamate.length, 1);
  const { url, init, corpo } = chiamate[0];
  assert.equal(url, `${REST.FIRESTORE_BASE}:runQuery?key=k`);
  assert.equal(init.headers.Authorization, 'Bearer tok');
  const q = corpo.structuredQuery;
  assert.deepEqual(q.from, [{ collectionId: 'wallet-usage' }]);
  assert.deepEqual(q.select.fields.map((f) => f.fieldPath).sort(), ['at', 'model', 'servedBy']);
  assert.deepEqual(q.orderBy, [{ field: { fieldPath: 'at' }, direction: 'DESCENDING' }]);
  assert.equal(q.limit, W.SERVITO_ULTIME);
  assert.ok(!q.select.fields.some((f) => f.fieldPath === 'pseudonym'), 'chi ha fatto la richiesta non serve, e non si legge');

  assert.equal(r.letti, 3);
  assert.equal(r.limite, W.SERVITO_ULTIME);
  assert.equal(r.dal, '2026-11-19T08:00:00.000Z');
  assert.equal(r.al, '2026-11-20T10:00:00.000Z');
  assert.deepEqual(r.conti, [
    { host: 'Novita', modello: 'qwen/qwen3', n: 2 },
    { host: 'DeepInfra', modello: 'qwen/qwen3', n: 1 },
  ]);
});

test('un rifiuto del server o un token mancante arrivano alla pagina come errore col motivo, non come elenco vuoto', async () => {
  const { fetch } = fintoFetch([{ error: { status: 'PERMISSION_DENIED' } }], { status: 403 });
  const l = Lettura.crea({ fetch, rest: () => REST });
  await assert.rejects(l.leggi({ idToken: 'tok' }), /registro d'uso 403 PERMISSION_DENIED/);
  await assert.rejects(l.leggi({ idToken: '' }), /rifai l’accesso/);
  await assert.rejects(Lettura.crea({ fetch, rest: () => ({}) }).leggi({ idToken: 'tok' }), /server non configurato/);
});

test('per fornitore: quote sul totale letto, maiuscole unite, modelli dal più servito, il «non detto» a parte', () => {
  const conti = [
    { host: 'Novita', modello: 'qwen/qwen3', n: 5 },
    { host: 'novita', modello: 'deepseek/v3', n: 1 },
    { host: 'DeepInfra', modello: 'qwen/qwen3', n: 3 },
    { host: '', modello: 'qwen/qwen3', n: 1 },
  ];
  const r = W.chiHaServito(conti, []);
  assert.deepEqual(r.map((x) => [x.host, x.n]), [['Novita', 6], ['DeepInfra', 3], ['', 1]]);
  assert.equal(r[0].quota, 0.6);
  assert.equal(r[1].quota, 0.3);
  assert.deepEqual(r[0].modelli, [{ modello: 'qwen/qwen3', n: 5 }, { modello: 'deepseek/v3', n: 1 }]);
  assert.ok(r.every((x) => !x.violazione), 'con la lista vuota nessuno viola');
  assert.ok(Math.abs(r.reduce((a, x) => a + x.quota, 0) - 1) < 1e-9);
});

test('il giudizio segue la lista data: escluso per tutte le righe, «non dal produttore» solo dove il modello lo chiede', () => {
  const conti = [
    { host: 'Novita', modello: 'qwen/qwen3', n: 4 },
    { host: 'Amazon Bedrock', modello: 'anthropic/claude-x', n: 2 },
    { host: 'Amazon Bedrock', modello: 'qwen/qwen3', n: 2 },
    { host: 'Anthropic', modello: 'anthropic/claude-x', n: 1 },
  ];
  const prima = W.chiHaServito(conti, []);
  assert.equal(prima.find((x) => x.host === 'Novita').violazione, '');
  assert.equal(prima.find((x) => x.host === 'Amazon Bedrock').violazione, 'not-producer');
  assert.equal(prima.find((x) => x.host === 'Amazon Bedrock').fuori, W.VIOLAZIONI_USO['not-producer']);
  assert.equal(prima.find((x) => x.host === 'Anthropic').violazione, '');

  const dopo = W.chiHaServito(conti, ['Novita', 'Amazon']);
  assert.equal(dopo.find((x) => x.host === 'Novita').violazione, 'excluded');
  assert.equal(dopo.find((x) => x.host === 'Novita').fuori, W.VIOLAZIONI_USO.excluded);
  assert.equal(dopo.find((x) => x.host === 'Amazon Bedrock').violazione, 'excluded', 'l\'esclusione vince sul modello');
});

test('righe storte del registro non rompono il conto, e niente righe vuol dire niente da mostrare', () => {
  const c = W.contaServito([null, 'x', { at: 5, model: null }, { servedBy: '  Novita  ', model: 'm' }]);
  assert.equal(c.letti, 2);
  assert.equal(c.dal, '');
  assert.deepEqual(c.conti.map((x) => [x.host, x.modello, x.n]).sort(), [['', '', 1], ['Novita', 'm', 1]]);
  assert.deepEqual(W.contaServito(undefined), { letti: 0, dal: '', al: '', conti: [] });
  assert.deepEqual(W.chiHaServito(undefined, undefined), []);
  assert.deepEqual(W.chiHaServito([{ host: 'X', modello: 'm', n: 0 }, { host: '__proto__', modello: 'm', n: 1 }], []).map((x) => x.host), ['__proto__']);
});
