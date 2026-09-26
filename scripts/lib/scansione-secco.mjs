// Una scansione della collezione pagata UNA volta per giro: la prova a secco
// mette da parte quello che ha letto, l'applicazione che la segue lo riusa.
// La regola e il perché: patterns/una-scansione-chiede-i-campi-che-usa-e-si-paga-una-volta.md

import { leggiCopia, scriviCopia, scordaCopia, rigaCopiaRiusata } from './copia-su-file.mjs';

// Il tempo di guardare l'elenco della prova a secco e decidere di applicarlo.
// Oltre, il database può essere cambiato e si rilegge: la copia è un risparmio,
// non una fonte di verità.
export const TTL_MS = 5 * 60_000;

/**
 * Il riuso si può rifiutare: `--rileggi` sulla riga di comando, o
 * `FILO_RILEGGI=1`. Serve a chi ha cambiato qualcosa sul server fra la prova a
 * secco e l'applicazione e vuole ripartire dai dati di adesso. PURA.
 */
export function copiaChiesta(argv = process.argv, env = process.env) {
  if ((Array.isArray(argv) ? argv : []).includes('--rileggi')) return false;
  return !['1', 'true', 'on', 'yes'].includes(String((env && env.FILO_RILEGGI) || '').trim().toLowerCase());
}

/**
 * @param {object} o
 * @param {string} o.nome     come si chiama questa scansione (una per script)
 * @param {boolean} o.dry     è una prova a secco? allora si legge e si salva
 * @param {Function} o.scansiona  la lettura vera, chiamata solo se serve
 * @returns {Promise<{dati:any, dallaCopia:boolean}>}
 */
export async function scansione({
  nome, dry = false, scansiona, now = Date.now(), dir = null, usaCopia = true,
  ttlMs = TTL_MS, log = console.log,
}) {
  // Una prova a secco NON riusa niente: deve guardare il database di adesso, o
  // mostrerebbe un elenco vecchio a chi la lancia proprio per decidere.
  const pronta = (usaCopia && !dry) ? leggiCopia(nome, { now, ttlMs, dir }) : null;
  if (pronta && pronta.dati !== undefined && pronta.dati !== null) {
    log(rigaCopiaRiusata(pronta.etaMs));
    return { dati: pronta.dati, dallaCopia: true };
  }
  const dati = await scansiona();
  if (usaCopia && dry) scriviCopia(nome, dati, { now, dir });
  return { dati, dallaCopia: false };
}

/** Applicato: quello che la copia descrive non è più il server, e va buttata. */
export function dopoApplicazione(nome, { dry = false, usaCopia = true, dir = null } = {}) {
  if (dry || !usaCopia) return false;
  return scordaCopia(nome, { dir });
}
