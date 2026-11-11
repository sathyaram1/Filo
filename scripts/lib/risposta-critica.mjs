// risposta-critica.mjs — la risposta del server alla critica, anche su file accanto ai pezzi della consegna (#2316):
// sull'uscita del comando sola si perdeva a un filtro, e con lei i rilievi da correggere. Fuori dal repo; si ristampa
// solo sul ramo che l'ha registrata (`dispatch.mjs --risposta-critica`). Regole: tests/unit/rispostaCritica.test.mjs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cartellaConsegna } from './consegna-file.mjs';

export const FILE_RISPOSTA_CRITICA = 'risposta-critica.md';
const TESTATA = /^<!-- risposta-critica (\{.*\}) -->\n/;

export function fileRispostaCritica(root, { dir = '' } = {}) {
  return join(dir || cartellaConsegna(root), FILE_RISPOSTA_CRITICA);
}

// Il testo resta leggibile com'è con un Read: i dati per riconoscerlo stanno nella prima riga.
export function scriviRispostaCritica(root, { id = '', ramo = '', sha = '', testo = '' } = {}, { dir = '' } = {}) {
  const f = fileRispostaCritica(root, { dir });
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  const testata = JSON.stringify({ id: String(id), ramo: String(ramo), sha: String(sha), scritta: new Date().toISOString() });
  writeFileSync(f, `<!-- risposta-critica ${testata} -->\n${String(testo)}\n`, { encoding: 'utf8', mode: 0o600 });
  return f;
}

/**
 * `{ testo, file, id, ramo, sha }`, o `{ errore }` con la frase da stampare. La cartella della consegna è per clone, e
 * il prossimo lavoro sullo stesso clone sta su un altro ramo: la risposta di un altro ramo non è sua e non si mostra.
 */
export function leggiRispostaCritica(root, { id = '', ramo = '', dir = '' } = {}) {
  const f = fileRispostaCritica(root, { dir });
  if (!existsSync(f)) {
    return { errore: `Nessuna risposta a una critica da ristampare (la cerco in ${f}): la scrive --record-verifier quando il server accetta la critica, e la consegna del lavoro dopo la cancella. Se la critica non è stata registrata, registrala.` };
  }
  let grezzo;
  try { grezzo = readFileSync(f, 'utf8'); } catch (e) { return { errore: `La risposta salvata in ${f} non si legge (${e.message}).` }; }
  const m = TESTATA.exec(grezzo);
  let dati = null;
  try { dati = m ? JSON.parse(m[1]) : null; } catch (_) { dati = null; }
  if (!dati || typeof dati !== 'object') return { errore: `Il file ${f} non è una risposta salvata da --record-verifier: non la ristampo.` };
  if (ramo && dati.ramo && dati.ramo !== ramo) {
    return { errore: `La risposta salvata in ${f} è della critica registrata sul ramo ${dati.ramo}, non su questo (${ramo}): non è del tuo lavoro.` };
  }
  if (id && dati.id && dati.id !== id) {
    return { errore: `La risposta salvata in ${f} è della critica di ${dati.id}, non di ${id}.` };
  }
  return { testo: grezzo.slice(m[0].length).replace(/\n$/, ''), file: f, id: dati.id || '', ramo: dati.ramo || '', sha: dati.sha || '' };
}
