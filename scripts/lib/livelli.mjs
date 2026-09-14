// Il testo di un livello (L3 la segnalazione, L4 la nota del controllo di
// sicurezza) letto da file, per le consegne. Sta qui perché lo usano due
// strumenti — dispatch (--record-*) e il canale (deliver status --segnala) —
// e dispatch importa il canale: una copia sola, senza cicli.
//
// Il file si legge INTERO, mai tosato: un testo oltre il tetto viene rifiutato
// col numero, e chi scrive accorcia lui (CLAUDE.md § Limiti).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
