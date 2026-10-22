// L'accensione del contenitore (#1498): l'identificativo che il server dà al sondaggio di partenza e che ogni richiesta
// di biglietto riporta, così la fiducia di un biglietto tiene conto di quello che il contenitore ha già lavorato. Non
// difende niente da sé: lo sporco lo decide e lo tiene il server (SPEC-DOMANDE § 1.2). Regole: tests/unit/accensione.test.mjs.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirImpostazioniUtente, impronta } from './orchestratore-cieco.mjs';

// Nelle impostazioni dell'utente, come il registro delle decisioni: un cambio di ramo o una pulizia del progetto non lo
// tocca, e una sessione cloud nuova parte senza.
export const FILE_ACCENSIONE = 'filo-accensione.json';
// Un'accensione vive quanto il suo orchestratore: un giorno lo copre, e un file rimasto da ieri non si riusa.
export const VALIDITA_ACCENSIONE_MS = 24 * 60 * 60 * 1000;

export function haFormaDiAccensione(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{16,256}$/.test(v);
}

/** L'accensione in una risposta del server, o '' se manca o ha una forma che non si rimanda. PURA. */
export function accensioneDa(body) {
  const v = body && typeof body === 'object' ? body.accensione : '';
  return haFormaDiAccensione(v) ? v : '';
}

/**
 * Quella ricordata per QUESTA parola d'ordine: `nota` dice se il sondaggio è già stato fatto (anche senza
 * identificativo, da un server che non lo dà), così il canale non lo rifà a ogni biglietto.
 * @returns {{ nota: boolean, accensione: string }}
 */
export function leggiAccensione(passphrase, { dir = dirImpostazioniUtente(), adesso = Date.now() } = {}) {
  let o = null;
  try { o = JSON.parse(readFileSync(join(dir, FILE_ACCENSIONE), 'utf8')); } catch (_) { return { nota: false, accensione: '' }; }
  const eta = adesso - Date.parse(String(o?.ora || ''));
  if (!o || o.chiave !== impronta(passphrase) || !(eta >= -60_000 && eta < VALIDITA_ACCENSIONE_MS)) return { nota: false, accensione: '' };
  return { nota: true, accensione: haFormaDiAccensione(o.accensione) ? o.accensione : '' };
}

/** Della parola d'ordine resta l'impronta, mai il testo. Non scriverla costa un sondaggio in più, mai un biglietto. */
export function scriviAccensione(passphrase, accensione, { dir = dirImpostazioniUtente(), adesso = Date.now() } = {}) {
  const file = join(dir, FILE_ACCENSIONE);
  const voce = { chiave: impronta(passphrase), accensione: haFormaDiAccensione(accensione) ? accensione : '', ora: new Date(adesso).toISOString() };
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(voce, null, 2)}\n`);
    renameSync(tmp, file);
  } catch (e) { return { ok: false, file, why: e.message }; }
  return { ok: true, file };
}
