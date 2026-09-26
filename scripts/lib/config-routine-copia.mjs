// La copia breve di `config/routines`, condivisa fra dispatch e verify-local.
//
// Lo stesso documento lo rileggevano tutti e due a ogni invocazione: decine di
// letture per sessione, per nove sessioni, per una risposta che cambia quando
// l'owner tocca un interruttore (#680).
//
// SESSANTA SECONDI, non più: la copia non deve mai far partire un giro con
// impostazioni che l'owner ha cambiato da più di un minuto. Scaduta, assente o
// illeggibile → si rilegge dal server, che è il comportamento di sempre.

import { leggiCopia, scriviCopia } from './copia-su-file.mjs';

export const TTL_MS = 60_000;

// La chiave è l'URL: `FILO_ROUTINE_CONFIG_URL` punta a un server finto durante
// i controlli, e la sua copia non deve mai rispondere per quella vera.
// L'identità con cui si legge fa parte della chiave: una lettura con la sola
// chiave pubblica e una col token dell'owner possono vedere documenti diversi,
// e una copia non è il posto dove scoprirlo.
function chiave(url, conToken) {
  return `config-routines|${conToken ? 'owner' : 'pubblico'}|${String(url || '')}`;
}

/**
 * I campi Firestore del documento, se la copia è ancora valida.
 * @returns {{fields:object, etaMs:number}|null}
 */
export function campiDaCopia(url, { conToken = false, now = Date.now(), ttlMs = TTL_MS, dir = null } = {}) {
  const c = leggiCopia(chiave(url, conToken), { now, ttlMs, dir });
  if (!c || !c.dati || typeof c.dati !== 'object') return null;
  const fields = c.dati.fields;
  // `{}` è una risposta legittima (documento mai scritto: 404 ⇒ default), ma
  // deve essere un oggetto: una copia senza `fields` è una copia rotta.
  if (!fields || typeof fields !== 'object') return null;
  return { fields, etaMs: c.etaMs };
}

/** Mette da parte i campi appena letti dal server. */
export function salvaCampiInCopia(url, fields, { conToken = false, now = Date.now(), dir = null } = {}) {
  return scriviCopia(chiave(url, conToken), { fields: (fields && typeof fields === 'object') ? fields : {} }, { now, dir });
}
