// La copia in memoria dei modelli di supporto (#679).
//
// Il caso. `config/supportModels` e `config/judgeSecrets` si leggevano a OGNI
// chiamata: chi risolve lo slot di un giudice lo fa per ogni giudizio, quindi
// due letture di Firestore ogni volta, per un documento che cambia quando
// l'owner lo salva.
//
// E una rete caduta non deve avvelenare la copia buona: una lettura fallita
// rende una configurazione VUOTA, e chi risolve uno slot ricadrebbe sui modelli
// scritti nel codice invece di usare quelli che l'owner ha scelto.
//
// Senza il fix è ROSSO: ogni chiamata partiva verso Firestore.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const auth = require(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
const Support = require(join(ROOT, 'src', 'main', 'services', 'supportModelsStore.js'));

let orologio = 1_000_000;
let profilo = { email: 'owner@esempio' };
let admin = true;

beforeEach(() => {
  Support.invalidaCache();
  orologio = 1_000_000;
  profilo = { email: 'owner@esempio' };
  admin = true;
  Support._setAdesso(() => orologio);
});

// Finge rete e sessione. `stato.sanitizer` è quello che il documento dice,
// `stato.giu` fa cadere la lettura.
function conRete(stato, fn) {
  const orig = { token: auth.getIdToken, admin: auth.isAdmin, profilo: auth.getProfile, fetch: global.fetch };
  const chiamate = [];
  auth.getIdToken = async () => 'finto-id-token';
  auth.isAdmin = () => admin;
  auth.getProfile = () => profilo;
  global.fetch = async (url, opts) => {
    const u = String(url);
    chiamate.push({ url: u, metodo: (opts && opts.method) || 'GET' });
    if (opts && opts.method === 'PATCH') {
      return { ok: true, status: 200, async json() { return {}; }, async text() { return ''; } };
    }
    if (stato.giu) return { ok: false, status: 503, async json() { return {}; }, async text() { return ''; } };
    return {
      ok: true,
      status: 200,
      async json() { return { fields: { sanitizer: { stringValue: stato.sanitizer } } }; },
      async text() { return ''; },
    };
  };
  return Promise.resolve()
    .then(() => fn(chiamate))
    .finally(() => {
      auth.getIdToken = orig.token; auth.isAdmin = orig.admin;
      auth.getProfile = orig.profilo; global.fetch = orig.fetch;
    });
}

const letture = (chiamate) => chiamate.filter((c) => c.metodo === 'GET').length;

test('due richieste ravvicinate fanno UNA lettura dei due documenti', async () => {
  await conRete({ sanitizer: 'kimi' }, async (chiamate) => {
    const primo = await Support.get();
    orologio += 60_000;
    const secondo = await Support.get();
    assert.equal(letture(chiamate), 2, 'i documenti sono due: una richiesta ciascuno, non due giri');
    assert.equal(secondo.sanitizer, 'kimi');
    assert.deepEqual(secondo, primo);
  });
});

test('scaduta la copia si rilegge', async () => {
  await conRete({ sanitizer: 'kimi' }, async (chiamate) => {
    await Support.get();
    orologio += Support.CACHE_TTL_MS + 1;
    await Support.get();
    assert.equal(letture(chiamate), 4);
  });
});

test('chi salva vede il salvato: il salvataggio butta la copia', async () => {
  const stato = { sanitizer: 'kimi' };
  await conRete(stato, async () => {
    assert.equal((await Support.get()).sanitizer, 'kimi');
    stato.sanitizer = 'flash';
    const dopo = await Support.update({ sanitizer: 'flash' }, 'finto-id-token');
    assert.equal(dopo.sanitizer, 'flash', 'la risposta al salvataggio è già quella nuova');
    assert.equal((await Support.get()).sanitizer, 'flash');
  });
});

test('una lettura fallita non avvelena la copia buona', async () => {
  const stato = { sanitizer: 'kimi', giu: false };
  await conRete(stato, async () => {
    assert.equal((await Support.get()).sanitizer, 'kimi');
    stato.giu = true;
    orologio += Support.CACHE_TTL_MS + 1;
    assert.equal((await Support.get()).sanitizer, 'kimi',
      'con la rete giù si usa la configurazione buona, non una vuota che fa ricadere sui modelli scritti nel codice');
    stato.giu = false;
    orologio += Support.CACHE_TTL_ERRORE_MS + 1;
    assert.equal((await Support.get()).sanitizer, 'kimi');
  });
});

test('un altro account non si serve dalla copia del precedente', async () => {
  await conRete({ sanitizer: 'kimi' }, async (chiamate) => {
    await Support.get();
    const prima = letture(chiamate);
    profilo = { email: 'altro@esempio' };
    admin = false;
    await Support.get();
    assert.ok(letture(chiamate) > prima,
      'i documenti dei giudici li legge solo chi ha i diritti: la risposta non si eredita da chi c’era prima');
  });
});

test('chi riceve la configurazione non può modificare la copia condivisa', async () => {
  await conRete({ sanitizer: 'kimi' }, async () => {
    const primo = await Support.get();
    primo.sanitizer = 'manomesso';
    assert.equal((await Support.get()).sanitizer, 'kimi');
  });
});
