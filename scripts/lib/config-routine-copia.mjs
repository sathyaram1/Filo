// La copia breve di `config/routines`, una per dispatch e verify-local: lo stesso
// documento lo rileggevano tutti e due a ogni invocazione (#680). SESSANTA
// SECONDI, non più: un interruttore spento da un minuto deve essere già arrivato.

import { leggiCopia, scriviCopia } from './copia-su-file.mjs';

export const TTL_MS = 60_000;

// L'identità con cui si legge fa parte della chiave: una lettura con la sola
// chiave pubblica e una col token dell'owner possono vedere documenti diversi,
// e una copia non è il posto dove scoprirlo.
function chiave(url, conToken) {
  return `config-routines|${conToken ? 'owner' : 'pubblico'}|${String(url || '')}`;
}

/**
 * La copia è un risparmio di PRODUZIONE. `FILO_ROUTINE_CONFIG_URL` esiste per i
 * controlli, che fanno rispondere a un server finto cose diverse a ogni passo:
 * lì la lettura deve restare quella vera, o si controllerebbe una copia.
 */
export function copiaAttiva(env = process.env) {
  return !String((env && env.FILO_ROUTINE_CONFIG_URL) || '').trim();
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
