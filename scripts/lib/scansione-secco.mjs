// Una scansione della collezione pagata UNA volta per giro.
//
// Uno script di manutenzione si lancia due o tre volte di seguito: prova a
// secco, applicazione, controllo. Ogni giro rileggeva la collezione intera
// (#680). Qui la prova a secco mette da parte quello che ha letto e
// l'applicazione che la segue lo riusa, dicendolo a video.
//
// La regola sta in questo file solo, non in ognuno dei quattro script.

import { leggiCopia, scriviCopia, scordaCopia, rigaCopiaRiusata } from './copia-su-file.mjs';

// Il tempo di guardare l'elenco della prova a secco e decidere di applicarlo.
// Oltre, il database può essere cambiato e si rilegge: la copia è un risparmio,
// non una fonte di verità.
export const TTL_MS = 5 * 60_000;

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
