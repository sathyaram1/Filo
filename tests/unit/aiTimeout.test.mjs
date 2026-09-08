// #520 — una chiamata al modello che non torna MAI lasciava la chat su "Filo
// sta pensando…" per sempre: nessun errore da leggere, nessun modo di riprovare.
// Qui il router finto accetta la richiesta e poi tace: la chiamata deve
// finire da sola con un errore `code: 'TIMEOUT'`, tradotto in una frase per
// l'utente. Senza la sorveglianza il primo assert di ogni test dice "appeso".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'src');

// Tetti ridotti a millisecondi: si prova il MECCANISMO, non l'orologio.
process.env.FILO_AI_STALLO_MS = '60';
process.env.FILO_AI_TETTO_MS = '120';

require(join(SRC, 'shared', 'netTimeout.js'));
require(join(SRC, 'shared', 'chatErrors.js'));
require(join(SRC, 'main', 'services', 'providers', 'openrouter.js'));
const OpenRouter = globalThis.SN_PROVIDER_OPENROUTER;
const CE = globalThis.SN_CHAT_ERRORS;

function erroreAnnullato() {
  const e = new Error('This operation was aborted');
  e.name = 'AbortError';
  return e;
}

// Promessa che si risolve solo quando il segnale viene annullato: è il
// comportamento di `fetch` verso un server che tiene aperta la connessione.
function appesaFinoAdAbort(signal) {
  return new Promise((_res, rej) => {
    if (!signal) return; // nessuna sorveglianza: appesa per sempre, come prima
    if (signal.aborted) { rej(erroreAnnullato()); return; }
    signal.addEventListener('abort', () => rej(erroreAnnullato()), { once: true });
  });
}

// Esito della promessa, oppure la stringa 'appeso' se non arriva niente:
// così un test che fallisce fallisce SUBITO invece di bloccare la suite.
async function esitoEntro(p, ms = 3000) {
  return Promise.race([
    p.then(() => 'risposta', (e) => e),
    new Promise((r) => setTimeout(() => r('appeso'), ms)),
  ]);
}

function conFetch(impl, run) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve(run()).finally(() => { globalThis.fetch = orig; });
}

test('complete: il router che tace non blocca per sempre', async () => {
  await conFetch((_url, opts) => appesaFinoAdAbort(opts && opts.signal), async () => {
    const esito = await esitoEntro(OpenRouter.complete({ apiKey: 'k', model: 'm', messages: [] }));
    assert.notEqual(esito, 'appeso', 'l\'attesa deve finire da sola');
    assert.equal(esito.code, 'TIMEOUT');
    assert.equal(esito.provider, 'openrouter');
  });
});

test('streamComplete: uno stream che si ammutolisce a metà finisce con un errore', async () => {
  // Risposta OK, poi il flusso emette un pezzo e tace: è il caso peggiore,
  // quello in cui la bolla mostrava del ragionamento e poi restava lì.
  const fetchMuto = (_url, opts) => {
    const signal = opts && opts.signal;
    let primo = true;
    return Promise.resolve({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () => {
            if (primo) {
              primo = false;
              const chunk = 'data: {"choices":[{"delta":{"content":"ciao"}}]}\n';
              return Promise.resolve({ done: false, value: new TextEncoder().encode(chunk) });
            }
            return appesaFinoAdAbort(signal);
          },
        }),
      },
    });
  };
  await conFetch(fetchMuto, async () => {
    const pezzi = [];
    const esito = await esitoEntro(OpenRouter.streamComplete({
      apiKey: 'k', model: 'm', messages: [], onDelta: (d) => pezzi.push(d),
    }));
    assert.notEqual(esito, 'appeso', 'lo stallo dello stream deve interrompere l\'attesa');
    assert.equal(esito.code, 'TIMEOUT');
    assert.deepEqual(pezzi, ['ciao'], 'quello che era arrivato prima resta arrivato');
  });
});

test('chi interrompe è l\'utente: l\'errore resta un\'interruzione, non una scadenza', async () => {
  await conFetch((_url, opts) => appesaFinoAdAbort(opts && opts.signal), async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 10);
    const esito = await esitoEntro(OpenRouter.complete({
      apiKey: 'k', model: 'm', messages: [], signal: ac.signal,
    }));
    assert.notEqual(esito, 'appeso');
    assert.equal(esito.name, 'AbortError');
    assert.notEqual(esito.code, 'TIMEOUT');
  });
});

test('la scadenza diventa una frase per l\'utente, non un codice', () => {
  const e = globalThis.SN_NET_TIMEOUT.timeoutError('stallo', { provider: 'openrouter' });
  const frase = CE.friendly(e);
  assert.match(frase, /smesso di rispondere/);
  assert.doesNotMatch(frase, /TIMEOUT|abort/i);
  // Ritentare la stessa chiamata rifarebbe aspettare tutto daccapo: non è un
  // guasto passeggero.
  assert.equal(CE.isTransientNetwork(e), false);
});

test('la scadenza di un archivio dati è attribuita a lui', () => {
  const e = globalThis.SN_NET_TIMEOUT.timeoutError('tetto', { cosa: 'Scryfall' });
  const frase = CE.friendly(e, { dataSource: 'Scryfall (l\'archivio delle carte)' });
  assert.match(frase, /Scryfall/);
  assert.match(frase, /non ha risposto in tempo/);
});
