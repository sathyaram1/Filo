// Il testo di un livello (L3 la segnalazione, L4 la nota del controllo di
// sicurezza) letto da file, per le consegne, e il livello che accompagna la
// segnalazione (`--livello`, `--difficile`). Sta qui perché lo usano due
// strumenti — dispatch (--record-*) e il canale (deliver status --segnala) —
// e dispatch importa il canale: una copia sola, senza cicli.
//
// Il file si legge INTERO, mai tosato: un testo oltre il tetto viene rifiutato
// col numero, e chi scrive accorcia lui (CLAUDE.md § Limiti).

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tetto sul testo di un livello, lo stesso del server. Oltre: rifiuto con il
// numero, qui, prima di chiamare il server.
export const MAX_LIVELLO_CHARS = 12000;

/**
 * Legge il testo di un livello da file. Un file assente o vuoto è un errore
 * chiaro, non un livello vuoto consegnato in silenzio.
 * @param {string} file percorso, relativo alla directory corrente
 * @param {string} nome il nome dell'opzione, per la frase (`segnala`, `nota`)
 * @returns {{ ok:true, testo:string }|{ ok:false, message:string }}
 */
export function leggiTestoLivello(file, nome) {
  const p = resolve(String(file || ''));
  if (!existsSync(p)) {
    return { ok: false, message: `--${nome}: il file ${file} non esiste (cercato in ${p}). Scrivilo prima, poi rilancia lo stesso comando: non ho consegnato niente.` };
  }
  let testo = '';
  try {
    testo = readFileSync(p, 'utf8');
  } catch (e) {
    return { ok: false, message: `--${nome}: non riesco a leggere ${file} (${e?.message || e}): non ho consegnato niente.` };
  }
  testo = testo.replace(/\r\n/g, '\n').trim();
  if (!testo) return { ok: false, message: `--${nome}: il file ${file} è vuoto. Ci va il testo per l'owner: non ho consegnato niente.` };
  if (testo.length > MAX_LIVELLO_CHARS) {
    return { ok: false, message: `--${nome}: ${testo.length} caratteri, il massimo è ${MAX_LIVELLO_CHARS} (lo stesso del server, che lo respingerebbe). Accorcia il testo, non i fatti: non ho consegnato niente.` };
  }
  return { ok: true, testo };
}

// La regola che decide se una segnalazione ferma è quella del server (src/shared/verifierRound.js); senza il modulo
// si presume che fermi, come prima di #1202.
const segnalazioneFerma = (() => {
  try {
    createRequire(import.meta.url)(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared', 'verifierRound.js'));
    const R = globalThis.SN_VERIFIER_ROUND;
    if (R && typeof R.segnalazioneFerma === 'function') return R.segnalazioneFerma;
  } catch (_) { /* paracadute */ }
  return () => true;
})();

export const SPIEGAZIONE_LIVELLO_SEGNALAZIONE = 'Con 3, o con --difficile (una scelta difficile da disfare: dati degli utenti, sicurezza, formati salvati su disco), il lavoro si ferma e aspetta l\'owner; con 2, 1 o 0 va avanti con la scelta che hai fatto nel frattempo, e la segnalazione diventa un feedback derivato con la domanda.';

/**
 * `--livello <0-3>` e `--difficile` accompagnano `--segnala`: il livello del problema e il segno «difficile da
 * disfare», da cui il server decide se fermare. Senza livello la consegna si rifiuta qui: un default lo
 * sceglierebbe al posto di chi segnala. PURA, a parte la regola caricata sopra.
 * @param {{ livello?: string|number|boolean, difficile?: unknown, conSegnalazione: boolean }} p
 * @returns {{ ok:true, campi:object, ferma:boolean }|{ ok:false, message:string }}
 */
export function livelloSegnalazione({ livello, difficile, conSegnalazione } = {}) {
  if (!conSegnalazione) {
    if (livello !== undefined || difficile !== undefined) {
      return { ok: false, message: '--livello e --difficile accompagnano --segnala <file.md> (il livello del problema segnalato): da soli non hanno dove andare, e non ho consegnato niente.' };
    }
    return { ok: true, campi: {}, ferma: false };
  }
  if (difficile !== undefined && difficile !== true) {
    return { ok: false, message: '--difficile non vuole un valore: c\'è o non c\'è. Non ho consegnato niente.' };
  }
  const testo = String(livello ?? '').trim();
  if (livello === undefined || livello === true || !/^[0-3]$/.test(testo)) {
    return { ok: false, message: `--segnala vuole anche --livello <0-3>, il livello del problema segnalato col metro dei rilievi${livello === undefined || livello === true ? '' : ` (letto: «${testo.slice(0, 20)}»)`}. ${SPIEGAZIONE_LIVELLO_SEGNALAZIONE} Non ho consegnato niente.` };
  }
  const level = Number(testo);
  const campi = { segnalazioneLivello: level, ...(difficile === true ? { segnalazioneDifficile: true } : {}) };
  return { ok: true, campi, ferma: segnalazioneFerma({ level, difficile: difficile === true }) };
}
