// Registro dei download avviati dal main che devono presentare al sito la
// pagina di provenienza (header Referer) — es. "Salva immagine come…" (#274)
// su siti con protezione hotlink, che rispondono 403 alle richieste "anonime".
//
// PERCHÉ QUI E NON IN downloadURL: passare { headers: { Referer } } a
// webContents.downloadURL NON funziona — Chromium tratta il Referer come campo
// dedicato della richiesta di rete e IGNORA un header extra con quel nome (la
// richiesta parte anonima, verificato osservando il server). L'unico punto in
// cui il motore lascia riscrivere il Referer è webRequest.onBeforeSendHeaders.
//
// Electron consente UN SOLO listener onBeforeSendHeaders per sessione, e quello
// è già occupato dal GPC (services/cookies.js): quel listener unico consulta
// questo registro (require lazy, come fa onBeforeRequest con l'ad-blocking).
//
// Uso: chi avvia il download chiama expect(url, referrer) PRIMA di
// downloadURL(url) e invoca la dispose ritornata quando il download si
// conclude. Le voci scadono comunque da sole (TTL) come rete di sicurezza.

'use strict';

// url richiesto → { referrer, expires }. Voce VIVA finché il download non è
// concluso: un resume() dopo un'interruzione è una NUOVA richiesta di rete
// (altro details.id) sullo stesso URL e deve ripresentare lo stesso Referer.
const pending = new Map();

// details.id → { referrer, expires }: i redirect di una richiesta già
// agganciata (stesso id, URL diverso) mantengono il Referer — la protezione
// hotlink può stare anche sul target del redirect.
const byRequestId = new Map();

const TTL_MS = 5 * 60 * 1000; // rete di sicurezza se la dispose non arriva

function prune() {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  for (const [k, v] of byRequestId) if (v.expires < now) byRequestId.delete(k);
}

// Registra "il prossimo download di `url` presenta `referrer`". Ritorna la
// funzione di cleanup da chiamare a download concluso.
function expect(url, referrer) {
  prune();
  url = String(url || '');
  referrer = String(referrer || '');
  if (!url || !/^https?:/i.test(referrer)) return () => {};
  const entry = { referrer, expires: Date.now() + TTL_MS };
  pending.set(url, entry);
  return () => {
    if (pending.get(url) === entry) pending.delete(url);
    for (const [id, e] of byRequestId) if (e === entry) byRequestId.delete(id);
  };
}

// Chiamato dall'unico onBeforeSendHeaders per sessione (services/cookies.js)
// per OGNI richiesta: ritorna il Referer da impostare, o null se la richiesta
// non è un download registrato (il caso normale: costo O(1) su mappe vuote).
function referrerFor(details) {
  if (process.env.FILO_DBG_REF) require('node:fs').appendFileSync(process.env.FILO_DBG_REF, `[referrerFor] ${details.resourceType} ${details.url} pending=${[...pending.keys()]}\n`);
  if (!pending.size && !byRequestId.size) return null;
  prune();
  const followed = byRequestId.get(details.id);
  if (followed) return followed.referrer; // hop di redirect della stessa richiesta
  const entry = pending.get(details.url);
  if (!entry) return null;
  byRequestId.set(details.id, entry);
  if (process.env.FILO_DBG_REF) require('node:fs').appendFileSync(process.env.FILO_DBG_REF, `[referrerFor] MATCH -> ${entry.referrer}\n`);
  return entry.referrer;
}

module.exports = { expect, referrerFor };
