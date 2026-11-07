// Una scansione della collezione pagata UNA volta per giro: la prova a secco mette da parte quello che ha letto,
// l'applicazione che la segue lo riusa solo confrontato col presente, e chi scrive confronta anche ogni riga (#680.2).
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

// Il confronto dice '' quando la copia vale ancora, o il perché non vale. Tutto il resto (nessun confronto, una
// risposta che non è un perché, un errore) è «non so», e un «non so» non lascia riusare.
async function perchéRileggere(confronta, dati) {
  if (typeof confronta !== 'function') return 'nessun confronto col presente';
  try {
    const m = await confronta(dati);
    return typeof m === 'string' ? m : 'il confronto col presente non ha risposto';
  } catch (e) {
    return `il confronto col presente è fallito (${String((e && e.message) || e).slice(0, 200)})`;
  }
}

/**
 * @param {object} o
 * @param {string} o.nome     come si chiama questa scansione (una per script)
 * @param {boolean} o.dry     è una prova a secco? allora si legge e si salva
 * @param {Function} o.scansiona  la lettura vera, chiamata solo se serve
 * @param {Function} o.confronta  (copia) → '' se vale ancora, il perché se no; senza, la copia non si riusa
 * @returns {Promise<{dati:any, dallaCopia:boolean, scartata:null|{dati:any, motivo:string}}>}
 *   `scartata`: la copia della prova a secco che il confronto ha rifiutato, per dire cosa è cambiato da allora.
 */
export async function scansione({
  nome, dry = false, scansiona, now = Date.now(), dir = null, usaCopia = true,
  ttlMs = TTL_MS, log = console.log, confronta = null,
}) {
  // Una prova a secco NON riusa niente: deve guardare il database di adesso, o
  // mostrerebbe un elenco vecchio a chi la lancia proprio per decidere.
  const pronta = (usaCopia && !dry) ? leggiCopia(nome, { now, ttlMs, dir }) : null;
  let scartata = null;
  if (pronta && pronta.dati !== undefined && pronta.dati !== null) {
    const motivo = await perchéRileggere(confronta, pronta.dati);
    if (!motivo) {
      log(rigaCopiaRiusata(pronta.etaMs));
      return { dati: pronta.dati, dallaCopia: true, scartata: null };
    }
    log(`La lettura della prova a secco non la riuso: ${motivo}. Rileggo.`);
    scartata = { dati: pronta.dati, motivo };
  }
  const dati = await scansiona();
  if (usaCopia && dry) scriviCopia(nome, dati, { now, dir });
  return { dati, dallaCopia: false, scartata };
}

/** Applicato: quello che la copia descrive non è più il server, e va buttata. */
export function dopoApplicazione(nome, { dry = false, usaCopia = true, dir = null } = {}) {
  if (dry || !usaCopia) return false;
  return scordaCopia(nome, { dir });
}
