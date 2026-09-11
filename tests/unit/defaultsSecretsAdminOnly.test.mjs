// #581 — l'app non legge più `config/secrets` se chi la usa non è admin, e le
// chiavi di fabbrica continuano ad arrivare lo stesso.
//
// Il caso. Quel documento (chiavi OpenRouter e Tavily che pagano le chiamate di
// tutti, più la chiave Google Safe Browsing) si leggeva con la sola condizione
// «loggato con email verificata», e l'app lo chiedeva a ogni refresh per
// chiunque avesse fatto login. Siccome il login accetta qualunque account
// Google e la chiave web di Firebase sta in un repo pubblico, quella condizione
// non era una barriera. Ora la regola Firestore è admin-only; qui si verifica
// l'altra metà, cioè che l'app si comporti di conseguenza invece di bussare a
// una porta chiusa — e soprattutto che chi non è admin NON resti senza chiavi.
//
// Senza il fix è ROSSO sul primo test: il vecchio `if (idToken)` chiedeva il
// documento a qualunque utente loggato.

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

// Finge una sessione: `signedIn` con o senza diritti di admin. defaultsStore
// tiene il riferimento al MODULO, quindi sostituire le due funzioni qui basta.
function conSessione({ admin }, fn) {
  const origToken = auth.getIdToken;
  const origAdmin = auth.isAdmin;
  const origFetch = global.fetch;
  const urls = [];
  auth.getIdToken = async () => 'finto-id-token';
  auth.isAdmin = () => admin;
  global.fetch = async (url) => {
    urls.push(String(url));
    // 404 = documento mai scritto: nessuna rete, nessun override.
    return { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
  };
  return Promise.resolve()
    .then(() => fn(urls))
    .finally(() => {
      auth.getIdToken = origToken;
      auth.isAdmin = origAdmin;
      global.fetch = origFetch;
    });
}

test('utente loggato NON admin: config/secrets non viene mai chiesto', async () => {
  await conSessione({ admin: false }, async (urls) => {
    await Defaults.refresh();
    assert.ok(!urls.some((u) => u.includes('config/secrets')),
      `nessuna richiesta deve toccare config/secrets, trovate: ${urls.join(', ')}`);
    // …ma la config non segreta sì: il refresh non è stato disattivato in blocco.
    assert.ok(urls.some((u) => u.includes('config/models')),
      'config/models deve continuare a essere letto (non è segreto)');
  });
});

test('admin: config/secrets viene letto (la pagina Modelli predefiniti serve)', async () => {
  await conSessione({ admin: true }, async (urls) => {
    await Defaults.refresh();
    assert.ok(urls.some((u) => u.includes('config/secrets')),
      'da admin il documento va letto, altrimenti l’editor non sa dire "configurata / non configurata"');
  });
});

test('chi non è admin resta con le chiavi di fabbrica, non a mani vuote', async () => {
  await conSessione({ admin: false }, async () => {
    await Defaults.refresh();
    const eff = Defaults.get();
    // Il contratto non cambia: le chiavi ci sono (vuote solo se il build non ne
    // ha incastonata nessuna, che è il caso di uno sviluppo locale senza env).
    assert.equal(typeof eff.apiKeys.openrouter, 'string');
    assert.equal(typeof eff.apiKeys.tavily, 'string');
    assert.equal(typeof eff.safeBrowsingKey, 'string');
  });
});

test('un admin che esce di sessione non tiene in uso le chiavi che non può più leggere', async () => {
  // Prima da admin, con un override vero nel documento.
  const origToken = auth.getIdToken;
  const origAdmin = auth.isAdmin;
  const origFetch = global.fetch;
  auth.getIdToken = async () => 'finto-id-token';
  auth.isAdmin = () => true;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('config/secrets')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            fields: {
              apiKeys: { mapValue: { fields: { tavily: { stringValue: 'tvly-ruotata' } } } },
              safeBrowsingKey: { stringValue: 'gsb-ruotata' },
            },
          };
        },
        async text() { return ''; },
      };
    }
    return { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
  };
  try {
    await Defaults.refresh();
    assert.equal(Defaults.get().apiKeys.tavily, 'tvly-ruotata');
    assert.equal(Defaults.get().safeBrowsingKey, 'gsb-ruotata');

    // Poi da non-admin: l'override deve sparire dalla cache, non sopravvivere.
    auth.isAdmin = () => false;
    await Defaults.refresh();
    assert.notEqual(Defaults.get().apiKeys.tavily, 'tvly-ruotata');
    assert.notEqual(Defaults.get().safeBrowsingKey, 'gsb-ruotata');
  } finally {
    auth.getIdToken = origToken;
    auth.isAdmin = origAdmin;
    global.fetch = origFetch;
  }
});
