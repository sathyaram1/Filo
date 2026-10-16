// #1240: un «fetch failed» del runner verso il server delle chiavi fermava una piattaforma intera,
// mentre le altre lo raggiungevano nello stesso minuto. Ciò che può guarire aspettando si ritenta;
// un rifiuto no, e quando si arrende il guasto dice quanti tentativi e quanta attesa.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRemoteKeys, esitoDaRitentare, descriviEsitoServer, ATTESE_SERVER_MS } from '../../scripts/bake-default-config.mjs';

const guastoFetch = (code) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`getaddrinfo ${code} europe-west1`), { code }) });
const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
const CHIAVI = { ok: true, apiKeys: { tavily: 't' }, safeBrowsingKey: 'g' };

// Ogni voce è una risposta (o un errore da lanciare) per il tentativo di quel numero.
function finto(copione) {
  const chiamate = [];
  const attese = [];
  return {
    chiamate,
    attese,
    fetchImpl: async (url, init) => {
      chiamate.push({ url, init });
      const passo = copione[Math.min(chiamate.length - 1, copione.length - 1)];
      if (passo instanceof Error) throw passo;
      return passo();
    },
    sleep: async (ms) => { attese.push(ms); },
  };
}

test('un singhiozzo di rete costa un tentativo, non la piattaforma', async () => {
  const f = finto([guastoFetch('EAI_AGAIN'), () => json(CHIAVI)]);
  const r = await fetchRemoteKeys('giusta', f);
  assert.equal(r.esito.stato, 'ok');
  assert.equal(r.apiKeys.tavily, 't');
  assert.equal(r.apiKeys.safeBrowsing, 'g');
  assert.equal(f.chiamate.length, 2);
  assert.deepEqual(f.attese, [ATTESE_SERVER_MS[0]]);
});

test('un server che inciampa (5xx, 429, 408) si riprova', async () => {
  for (const status of [500, 502, 503, 429, 408]) {
    const f = finto([() => json({ ok: false }, status), () => json(CHIAVI)]);
    const r = await fetchRemoteKeys('giusta', f);
    assert.equal(r.esito.stato, 'ok', `HTTP ${status}`);
    assert.equal(f.chiamate.length, 2, `HTTP ${status}`);
  }
});

test('un rifiuto non guarisce aspettando: un tentativo solo', async () => {
  for (const passo of [
    () => json({ ok: false, reason: 'bad_passphrase' }),
    () => json({ ok: false }, 401),
    () => json({ ok: false }, 403),
    () => new Response('<html>', { status: 200 }),
    () => json({ ok: true, apiKeys: {} }),
  ]) {
    const f = finto([passo, () => json(CHIAVI)]);
    const r = await fetchRemoteKeys('sbagliata', f);
    assert.notEqual(r.esito.stato, 'ok');
    assert.equal(f.chiamate.length, 1, r.esito.stato);
    assert.deepEqual(f.attese, []);
    assert.equal(r.esito.tentativi, undefined);
  }
});

test('rete giù davvero: si arrende dopo tutti i tentativi e lo dice, con la causa vera', async () => {
  const f = finto([guastoFetch('EAI_AGAIN')]);
  const r = await fetchRemoteKeys('giusta', f);
  assert.equal(f.chiamate.length, ATTESE_SERVER_MS.length + 1);
  assert.deepEqual(f.attese, ATTESE_SERVER_MS);
  assert.equal(r.esito.stato, 'rete');
  const frase = descriviEsitoServer(r.esito);
  assert.match(frase, /EAI_AGAIN/, 'il «fetch failed» da solo non dice cosa è successo');
  assert.match(frase, new RegExp(`${ATTESE_SERVER_MS.length + 1}° tentativo`));
  assert.match(frase, new RegExp(`${ATTESE_SERVER_MS.reduce((a, b) => a + b, 0) / 1000} s`));
});

test('ogni tentativo ha un tetto di tempo: un server muto non tiene fermo il lavoro', async () => {
  const f = finto([() => json(CHIAVI)]);
  await fetchRemoteKeys('giusta', f);
  assert.ok(f.chiamate[0].init.signal instanceof AbortSignal);
});

test('senza parola d’ordine non si chiama nessuno', async () => {
  const f = finto([() => json(CHIAVI)]);
  const r = await fetchRemoteKeys('', f);
  assert.equal(r.esito.stato, 'passphrase-assente');
  assert.equal(f.chiamate.length, 0);
});

test('cosa si ritenta: la tabella', () => {
  assert.equal(esitoDaRitentare({ stato: 'rete' }), true);
  for (const s of [408, 429, 500, 503, 504]) assert.equal(esitoDaRitentare({ stato: 'http', status: s }), true, s);
  for (const s of [400, 401, 403, 404]) assert.equal(esitoDaRitentare({ stato: 'http', status: s }), false, s);
  for (const stato of ['rifiutato', 'illeggibile', 'senza-chiavi', 'ok', 'passphrase-assente']) assert.equal(esitoDaRitentare({ stato }), false, stato);
  assert.equal(esitoDaRitentare(null), false);
});

test('la frase del guasto non inventa tentativi che non ci sono stati', () => {
  assert.doesNotMatch(descriviEsitoServer({ stato: 'rete', messaggio: 'x' }), /tentativo/);
  assert.doesNotMatch(descriviEsitoServer({ stato: 'ok', tentativi: 2, attesaS: 5 }), /tentativo/, 'il server ha risposto: niente da raccontare');
});
