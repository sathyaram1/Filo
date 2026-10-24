// Le righe di un file (i rossi di una corsa) stampate come annotazioni d'errore di GitHub. Dalla cloud delle routine
// registri e allegati di una corsa non si scaricano; le annotazioni si leggono con l'API (check-runs/<lavoro>/annotations).
// Non decide niente: esce 0 sempre. Uso: node scripts/annotazioni-github.mjs <file> "<titolo>". Regole: tests/unit/annotazioniGithub.test.mjs.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// GitHub tiene dieci annotazioni d'errore per passo e accorcia quelle lunghe: pezzi ben sotto i 4 KB.
export const MAX_ANNOTAZIONI = 10;
export const BYTE_PER_ANNOTAZIONE = 3500;

const byte = (s) => Buffer.byteLength(s, 'utf8');

/** Il dato di un comando di workflow: `%`, a capo e ritorno codificati, o il comando si spezza alla prima riga. PURA. */
export function dato(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** Una proprietà di un comando di workflow (il titolo): come il dato, più `:` e `,` che la chiuderebbero. PURA. */
export function proprieta(s) {
  return dato(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/** Una riga più lunga di un'annotazione intera, accorciata dicendolo. PURA. */
function rigaChiStaInUnPezzo(r) {
  if (byte(r) <= BYTE_PER_ANNOTAZIONE) return r;
  const coda = ' … (riga accorciata: intera nel registro della corsa)';
  let s = r;
  while (s && byte(s) + byte(coda) > BYTE_PER_ANNOTAZIONE) s = s.slice(0, Math.floor(s.length * 0.9));
  return s + coda;
}

/**
 * Le righe non vuote in comandi `::error title=…::…`, a pezzi interi di righe. Oltre le dieci annotazioni l'ultima dice
 * quante righe mancano: un taglio muto farebbe credere a chi legge di avere l'elenco intero. PURA.
 */
export function annotazioni(righe, titolo = 'Rossi') {
  const tutte = (Array.isArray(righe) ? righe : []).map((r) => String(r).trim()).filter(Boolean).map(rigaChiStaInUnPezzo);
  const pezzi = [];
  let pezzo = [];
  for (const r of tutte) {
    if (pezzo.length && byte([...pezzo, r].join('\n')) > BYTE_PER_ANNOTAZIONE) { pezzi.push(pezzo); pezzo = []; }
    pezzo.push(r);
  }
  if (pezzo.length) pezzi.push(pezzo);
  if (pezzi.length > MAX_ANNOTAZIONI) {
    const fuori = pezzi.splice(MAX_ANNOTAZIONI - 1).flat();
    pezzi.push([`… elenco tagliato: altre ${fuori.length} righe stanno nel registro e negli allegati della corsa`]);
  }
  const n = pezzi.length;
  return pezzi.map((p, i) => `::error title=${proprieta(`${titolo} (${tutte.length}${n > 1 ? `, parte ${i + 1} di ${n}` : ''})`)}::${dato(p.join('\n'))}`);
}

function main(argv) {
  const [file, titolo] = argv;
  if (!file || !existsSync(resolve(file))) return;
  for (const a of annotazioni(readFileSync(resolve(file), 'utf8').split(/\r?\n/), titolo || undefined)) console.log(a);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`annotazioni non scritte: ${String(e?.message || e)}`); }
}
