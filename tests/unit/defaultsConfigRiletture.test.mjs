// Ogni quanto l'app rilegge la config remota dei modelli (#679).
//
// Il caso. `config/models` si rileggeva ogni cinque minuti su OGNI
// installazione: trecento letture di Firestore al giorno a testa per un
// documento che cambia quando l'owner lo tocca. La rilettura periodica serve
// solo alle installazioni ALTRUI, perché su quella di chi salva la config
// torna aggiornata subito — `update()` chiude rileggendo.
//
// Senza il fix è ROSSO: il tetto era cinque minuti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const auth = require(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
const Defaults = require(join(ROOT, 'src', 'main', 'services', 'defaultsStore.js'));

// Finge la rete: ogni GET su config/models rende il provider che le si dice,
// ogni PATCH va a buon fine. Rende l'elenco delle chiamate fatte.
function conRete(statoRemoto, fn) {
  const origToken = auth.getIdToken;
  const origAdmin = auth.isAdmin;
  const origFetch = global.fetch;
  const chiamate = [];
  auth.getIdToken = async () => 'finto-id-token';
  auth.isAdmin = () => false;
  global.fetch = async (url, opts) => {
    const u = String(url);
    chiamate.push({ url: u, metodo: (opts && opts.method) || 'GET' });
    if (opts && opts.method === 'PATCH') {
      return { ok: true, status: 200, async json() { return {}; }, async text() { return ''; } };
    }
    return {
      ok: true,
      status: 200,
      async json() { return { fields: { provider: { stringValue: statoRemoto.provider } } }; },
      async text() { return ''; },
    };
  };
  return Promise.resolve()
    .then(() => fn(chiamate))
    .finally(() => {
      auth.getIdToken = origToken;
      auth.isAdmin = origAdmin;
      global.fetch = origFetch;
    });
}

const letture = (chiamate) => chiamate.filter((c) => c.metodo === 'GET' && c.url.includes('config/models')).length;

test('il tetto della rilettura periodica sta fra mezz’ora e un’ora', () => {
  assert.ok(Defaults.DEFAULT_MAX_AGE_MS >= 30 * 60 * 1000 && Defaults.DEFAULT_MAX_AGE_MS <= 60 * 60 * 1000,
    `rilettura ogni ${Math.round(Defaults.DEFAULT_MAX_AGE_MS / 60000)} minuti: sotto la mezz’ora torna a costare centinaia di letture al giorno per persona`);
});

test('due richieste ravvicinate fanno UNA lettura sola', async () => {
  await conRete({ provider: 'openrouter' }, async (chiamate) => {
    await Defaults.refresh();
    const dopoIlPrimo = letture(chiamate);
    await Defaults.refreshIfStale();
    await Defaults.refreshIfStale();
    assert.equal(letture(chiamate), dopoIlPrimo, 'il documento non va richiesto a ogni giro');
  });
});

test('scaduto il tetto si rilegge', async () => {
  await conRete({ provider: 'openrouter' }, async (chiamate) => {
    await Defaults.refresh();
    const prima = letture(chiamate);
    await Defaults.refreshIfStale(0);
    assert.equal(letture(chiamate), prima + 1);
  });
});

test('chi salva la config la vede cambiata subito, non alla scadenza', async () => {
  const remoto = { provider: 'openrouter' };
  await conRete(remoto, async () => {
    await Defaults.refresh();
    assert.equal(Defaults.get().provider, 'openrouter');
    // L'owner salva dalla schermata dei modelli predefiniti: da qui in avanti
    // il documento remoto dice un'altra cosa.
    remoto.provider = 'altro-fornitore';
    await Defaults.update({ provider: 'altro-fornitore' }, 'finto-id-token');
    assert.equal(Defaults.get().provider, 'altro-fornitore',
      'dopo il salvataggio la config in uso è quella nuova, senza aspettare la rilettura periodica');
    // …e la rilettura periodica resta pigra: il salvataggio ha appena
    // rinfrescato, quindi non deve ripartire una lettura.
    await conRete(remoto, async (dopo) => {
      await Defaults.refreshIfStale();
      assert.equal(letture(dopo), 0);
    });
  });
});
