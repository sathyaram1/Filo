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
    orologio += 1000;
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

// ── Com'è andata la lettura, non solo cosa ha portato (#679, primo giro) ─────
//
// Tre esiti diversi finivano nello stesso cassetto: documento letto, permesso
// negato, richiesta non partita. Il secondo è la risposta NORMALE per chiunque
// non gestisca Filo, e trattarlo da guasto di passaggio faceva ripartire le due
// letture ogni mezzo minuto invece che ogni cinque minuti.

// Rete che risponde per ogni documento quello che le si dice: 'ok', 'negato'
// (403, come le regole del server a chi non gestisce Filo) o 'giu' (niente
// risposta). Rende il conto delle richieste partite.
function conRisposte(perDoc, fn) {
  const orig = { token: auth.getIdToken, admin: auth.isAdmin, profilo: auth.getProfile, fetch: global.fetch };
  const conto = { supportModels: 0, judgeSecrets: 0 };
  auth.getIdToken = async () => 'finto-id-token';
  auth.isAdmin = () => admin;
  auth.getProfile = () => profilo;
  global.fetch = async (url) => {
    const quale = String(url).includes('judgeSecrets') ? 'judgeSecrets' : 'supportModels';
    conto[quale] += 1;
    const come = perDoc[quale];
    if (come === 'giu') throw new Error('rete');
    if (come === 'negato') return { ok: false, status: 403, async json() { return {}; }, async text() { return 'denied'; } };
    return {
      ok: true, status: 200,
      async json() {
        return quale === 'judgeSecrets'
          ? { fields: { openrouterKey: { stringValue: 'sk-vera' } } }
          : { fields: { sanitizer: { stringValue: 'flash' } } };
      },
      async text() { return ''; },
    };
  };
  return Promise.resolve()
    .then(() => fn(conto))
    .finally(() => {
      auth.getIdToken = orig.token; auth.isAdmin = orig.admin;
      auth.getProfile = orig.profilo; global.fetch = orig.fetch;
    });
}

test('a chi non gestisce Filo il permesso negato vale i cinque minuti come una lettura riuscita', async () => {
  admin = false;
  profilo = { email: 'persona@esempio.it' };
  Support.invalidaCache();
  await conRisposte({ supportModels: 'negato', judgeSecrets: 'negato' }, async (conto) => {
    await Support.get();
    assert.equal(conto.supportModels, 1, 'premessa: la prima volta si chiede');
    orologio += 60 * 1000; // un minuto dopo, dentro i cinque minuti
    await Support.get();
    assert.equal(conto.supportModels, 1,
      'il «non ti riguarda» è la risposta normale per quasi tutti: non deve far ripartire le letture ogni mezzo minuto');
    orologio += 5 * 60 * 1000; // passati i cinque minuti si richiede
    await Support.get();
    assert.equal(conto.supportModels, 2);
  });
});

test('un singhiozzo sulla sola chiave dei giudici non si tiene per cinque minuti', async () => {
  const stato = { judgeSecrets: 'giu' };
  Support.invalidaCache();
  await conRisposte({ supportModels: 'ok', get judgeSecrets() { return stato.judgeSecrets; } }, async () => {
    const primo = await Support.get();
    assert.equal(primo.openrouterKeyPresent, false, 'premessa: la chiave non si è potuta leggere');
    // La rete torna. Chi gestisce Filo riapre la schermata dei modelli di
    // supporto: la chiave c'è, e la schermata deve dirlo.
    stato.judgeSecrets = 'ok';
    orologio += 1000;
    const secondo = await Support.get();
    assert.equal(secondo.openrouterKeyPresent, true,
      'una risposta a metà non va messa via come buona: la schermata direbbe che la chiave non c’è per cinque minuti');
  });
});

test('persa la chiave per un istante, l’ultima risposta buona vale più di un «non c’è» inventato', async () => {
  const stato = { judgeSecrets: 'ok' };
  Support.invalidaCache();
  await conRisposte({ supportModels: 'ok', get judgeSecrets() { return stato.judgeSecrets; } }, async () => {
    assert.equal((await Support.get()).openrouterKeyPresent, true, 'premessa: la chiave c’è');
    stato.judgeSecrets = 'giu';
    orologio += Support.CACHE_TTL_MS + 1000;
    assert.equal((await Support.get()).openrouterKeyPresent, true,
      'un singhiozzo non deve far sparire una chiave che c’è');
  });
});

// Una risposta arrivata a metà non si archivia: se la si archiviasse
// sopravviverebbe al ritorno della rete, e Filo continuerebbe a servire il
// valore di ripiego per tutta la durata della copia (#679, secondo giro).
test('gli slot letti a metà non restano fermi quando la rete torna', async () => {
  admin = true;
  profilo = { email: 'owner@esempio.it' };
  const stato = { supportModels: 'giu' };
  Support.invalidaCache();
  await conRisposte({ get supportModels() { return stato.supportModels; }, judgeSecrets: 'ok' }, async () => {
    assert.equal((await Support.get()).sanitizer, '', 'premessa: gli slot non si sono potuti leggere');
    stato.supportModels = 'ok';
    orologio += 1000; // un secondo dopo: la rete e' tornata
    assert.equal((await Support.get()).sanitizer, 'flash',
      'i controlli interni userebbero il modello scritto nel codice invece di quello scelto dall’owner');
  });
});

test('una risposta a metà non si mette via: la chiamata dopo ripassa dal server', async () => {
  admin = true;
  profilo = { email: 'owner@esempio.it' };
  Support.invalidaCache();
  await conRisposte({ supportModels: 'ok', judgeSecrets: 'giu' }, async (conto) => {
    await Support.get();
    assert.equal(conto.supportModels, 1, 'premessa: la prima volta si chiede');
    orologio += 1000;
    await Support.get();
    assert.equal(conto.supportModels, 2,
      'con metà risposta archiviata la schermata resterebbe indietro anche a rete tornata');
  });
});
