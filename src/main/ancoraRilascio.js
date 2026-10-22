// La lettura dell'àncora delle release su Firestore (#1501), a lettura pubblica e senza credenziali.
// Non scrive e non decide: il confronto col feed è R.esitoAncora (aggiornamentoRegole.js), il cancello sta in updater.js.
// Regole: tests/unit/aggiornamentoTag.test.mjs.
'use strict';

const R = require('./aggiornamentoRegole');

const TETTO_MS = 15000;

// Lo stack di rete di Chromium, come electron-updater: un proxy di sistema che lascia passare GitHub lascia passare questa.
function richiestaRete(url, opzioni) {
  try {
    const { net } = require('electron');
    if (net && typeof net.fetch === 'function') return net.fetch(url, opzioni);
  } catch (_) {}
  return fetch(url, opzioni);
}

async function chiediFirestore(url, richiesta) {
  const ctrl = new AbortController();
  let timer;
  const tempo = new Promise((_, no) => {
    timer = setTimeout(() => { ctrl.abort(); no(new Error('tempo scaduto')); }, TETTO_MS);
  });
  try {
    const res = await Promise.race([richiesta(url, { signal: ctrl.signal }), tempo]);
    if (res.status === 404) return { stato: 404, json: null };
    if (!res.ok) return null;
    return { stato: 200, json: await Promise.race([res.json(), tempo]) };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Il documento del tag; se non c'è, se la raccolta ha almeno un'àncora (la forma dell'esito: R.esitoAncora).
async function leggiAncora(tag, richiesta = richiestaRete) {
  const cfg = require('./auth/config');
  const base = `https://firestore.googleapis.com/v1/projects/${cfg.firebaseProjectId}/databases/(default)/documents/${R.COLLEZIONE_ANCORE}`;
  const chiave = `key=${encodeURIComponent(cfg.firebaseApiKey)}`;
  const doc = await chiediFirestore(`${base}/${encodeURIComponent(String(tag))}?${chiave}`, richiesta);
  if (!doc) return { letta: false };
  if (doc.stato === 200) return { letta: true, impronte: R.impronteDellAncora(doc.json), altre: true };
  const elenco = await chiediFirestore(`${base}?pageSize=1&mask.fieldPaths=versione&${chiave}`, richiesta);
  if (!elenco || elenco.stato !== 200) return { letta: false };
  const docs = elenco.json && elenco.json.documents;
  return { letta: true, impronte: null, altre: Array.isArray(docs) && docs.length > 0 };
}

module.exports = { leggiAncora };
