// Il testo di un livello (L3 la segnalazione, L4 la nota del controllo di
// sicurezza) letto da file, e cosa dire quando una segnalazione non ha fermato
// il lavoro. Sta qui perché lo usano due strumenti — dispatch (--record-*) e
// il canale (deliver … --segnala) — e dispatch importa il canale: una copia
// sola, senza cicli.
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

/**
 * Una consegna con la segnalazione che il server NON ha fermato (di solito quella già registrata e rimandata, che
 * il server riconosce e ripete senza leggerla, #705): la frase che lo dice, e da dove mandarla. '' se si è fermato. PURA.
 * @param {'verdict'|'fixed'|'status'} intento
 */
export function segnalazioneNonFermata(intento, reply, conSegnalazione, id = '<id>') {
  if (!conSegnalazione) return '';
  const r = reply && typeof reply === 'object' ? reply : {};
  if (r.outcome === 'stop') return '';
  const cosa = intento === 'verdict' ? 'La critica di questo commit era già registrata'
    : intento === 'fixed' ? 'La correzione era già consegnata' : 'La consegna era già registrata';
  const perche = r.replayed === true
    ? `${cosa}: il server l'ha riconosciuta come la stessa consegna e ha ridato la risposta di prima, senza leggere la segnalazione.`
    : 'Il server ha registrato la consegna senza fermare il lavoro, e non ha detto perché: la segnalazione non si dà per arrivata.';
  let strada = 'Non dare il lavoro per fermo.';
  if (intento === 'verdict' && r.outcome === 'fix') {
    strada = `Mandala con la consegna della correzione, che è dove ferma il lavoro: \`--record-fixed ${id} "<report>" --segnala <file.md>\` (o \`routine-channel.mjs deliver fixed --report "<report>" --segnala <file.md>\`).`;
  } else if (intento === 'verdict' || intento === 'fixed') {
    const dove = intento === 'fixed' ? 'il lavoro resta in coda per un\'altra verifica'
      : r.outcome === 'pass' ? 'il lavoro prosegue verso il controllo di sicurezza' : 'il lavoro non è fermo';
    strada = `Da questo biglietto nessuna consegna può più portarla: ${dove}. Perché l'owner la legga almeno nella chat del feedback, mandala come nota (\`routine-channel.mjs deliver note --notes "<il testo della segnalazione>"\`), che però non ferma niente; poi rilascia il biglietto.`;
  }
  return ['SEGNALAZIONE NON CONSEGNATA: il lavoro non si è fermato e l\'owner non la vede.', perche, strada].join('\n');
}
