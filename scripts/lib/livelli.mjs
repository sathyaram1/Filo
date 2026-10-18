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
// numero, qui, prima di chiamare il server. In BYTE: il testo finisce cifrato in
// un campo che le regole misurano (20.000), e in cirillico 12.000 caratteri non ci stavano.
export const MAX_LIVELLO_BYTES = 12000;

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
  const byte = Buffer.byteLength(testo, 'utf8');
  if (byte > MAX_LIVELLO_BYTES) {
    return { ok: false, message: `--${nome}: ${byte} byte, il massimo è ${MAX_LIVELLO_BYTES} (byte UTF-8, lo stesso tetto del server, che lo respingerebbe: una lettera accentata o cirillica ne vale 2). Accorcia il testo, non i fatti: non ho consegnato niente.` };
  }
  return { ok: true, testo };
}

export const SPIEGAZIONE_LIVELLO_SEGNALAZIONE = '--segnala vuole anche --livello <0-3>, il livello del problema, e --irreversibile se la scelta è difficile da disfare (dati degli utenti, sicurezza, formati salvati su disco). Fermano il lavoro solo un 3 o una scelta difficile da disfare; con le altre il lavoro va avanti con la scelta che consigli, e la segnalazione esce in un feedback derivato con la domanda per l\'owner';

/**
 * La segnalazione di una consegna dalle opzioni (`--segnala <file.md> --livello <0-3> [--irreversibile]`): il
 * livello è obbligatorio, perché è lui (col segno) a decidere se il lavoro si ferma (#1202). Niente file = niente
 * segnalazione, e allora livello e segno non hanno a cosa attaccarsi: errore, non un'opzione ignorata.
 * @returns {{ ok:true, testo:string, livello?:number, irreversibile?:boolean }|{ ok:false, message:string }}
 */
export function leggiSegnalazione({ file, livello, irreversibile } = {}) {
  const conLivello = livello !== undefined && livello !== null && livello !== false;
  if (!file) {
    if (conLivello || irreversibile === true) {
      return { ok: false, message: '--livello e --irreversibile valgono solo insieme a --segnala <file.md>: non ho consegnato niente.' };
    }
    return { ok: true, testo: '' };
  }
  const raw = String(conLivello && livello !== true ? livello : '').trim();
  if (!raw) return { ok: false, message: `${SPIEGAZIONE_LIVELLO_SEGNALAZIONE}. Non ho consegnato niente.` };
  if (!/^[0-3]$/.test(raw)) {
    return { ok: false, message: `--livello vuole un numero fra 0 e 3 (il metro dei rilievi), non «${raw.slice(0, 20)}»: non ho consegnato niente.` };
  }
  const letto = leggiTestoLivello(file, 'segnala');
  if (!letto.ok) return letto;
  return { ok: true, testo: letto.testo, livello: Number(raw), irreversibile: irreversibile === true };
}

/** I campi della segnalazione nel payload di una consegna (vuoto senza segnalazione). PURA. */
export function campiSegnalazione(seg) {
  const testo = String((seg && seg.testo) || '').trim();
  if (!testo) return {};
  const out = { segnalazione: testo };
  if (Number.isInteger(seg.livello)) out.segnalazioneLivello = seg.livello;
  if (seg.irreversibile === true) out.segnalazioneIrreversibile = true;
  return out;
}
