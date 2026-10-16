// #1240: un «fetch failed» al primo e unico tentativo ha lasciato la v0.2.241 senza i file per Linux.
// La richiesta delle chiavi è una lettura: un guasto di rete si ritenta; uno che resta si racconta con la causa e i tentativi.

import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchRemoteKeys, descriviEsitoServer } from '../../scripts/bake-default-config.mjs';

// Come lo lancia undici quando la rete del runner ha un singhiozzo: niente codice di socket in vista.
const singhiozzo = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo EAI_AGAIN europe-west1'), { code: 'EAI_AGAIN' }) });
const risposta = (json) => ({ ok: true, status: 200, json: async () => json });

test('un guasto di rete passeggero non lascia la costruzione senza le chiavi del server', async () => {
  let n = 0;
  const attese = [];
  const { apiKeys, esito } = await fetchRemoteKeys('giusta', {
    fetchImpl: async () => { if (n++ < 2) throw singhiozzo(); return risposta({ ok: true, apiKeys: { tavily: 'tv-1' } }); },
    sleep: async (ms) => { attese.push(ms); },
  });
  assert.equal(esito.stato, 'ok');
  assert.equal(apiKeys.tavily, 'tv-1', 'la chiave deve arrivare dal server al terzo tentativo');
  assert.equal(n, 3);
  assert.ok(attese.every((ms) => ms >= 1000), `fra un tentativo e l'altro si aspetta davvero (${attese})`);
});

test('se la rete resta giù il guasto dice la causa e quante volte ci si è provato', async () => {
  let n = 0;
  const { apiKeys, esito } = await fetchRemoteKeys('giusta', {
    fetchImpl: async () => { n++; throw singhiozzo(); },
    sleep: async () => {},
  });
  assert.deepEqual(apiKeys, {});
  assert.equal(esito.stato, 'rete');
  assert.ok(n >= 3, `almeno tre tentativi prima di arrendersi (${n})`);
  const frase = descriviEsitoServer(esito);
  assert.match(frase, /EAI_AGAIN/, '«fetch failed» da solo non dice cosa è successo');
  assert.match(frase, new RegExp(`${n} tentativi`));
});

test('una risposta del server non si ritenta: il rifiuto torna subito', async () => {
  let n = 0;
  const { esito } = await fetchRemoteKeys('sbagliata', {
    fetchImpl: async () => { n++; return risposta({ ok: false, reason: 'bad_passphrase' }); },
    sleep: async () => {},
  });
  assert.equal(n, 1);
  assert.equal(esito.stato, 'rifiutato');
});
