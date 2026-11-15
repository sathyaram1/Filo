// La consegna con la prova accanto dal lato di chi consegna (#2505): legge il JSON, lo controlla come il server e ci
// attacca l'esito della prova dei test nuovi. Regole: src/shared/consegna.js; prove: tests/unit/consegnaCanale.test.mjs.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import '../../src/shared/consegna.js';
import { cloneDellUltimaProva, esitoSalvato, provaDelRamo, testoDelRamo } from '../prova-test-nuovi.mjs';
import { estremiDelLavoro } from './lettura-diff.mjs';

const C = globalThis.SN_CONSEGNA;

export const FORMA_CONSEGNA = 'un JSON con «criteri» (nove righe { criterio, esito, prova } o { criterio, esito: «non si applica», motivo }), '
  + '«elementi» in un lavoro sull\'interfaccia ({ elemento, perche, clic, destro, trascina, hover }) e «classe» ({ valore, motivo })';

function percorsiDelRamo(root) {
  const e = estremiDelLavoro(root);
  if (e.errore) return { errore: e.errore };
  const out = execFileSync('git', ['diff', '--name-only', '-z', e.base, e.head], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  return { percorsi: out.split('\0').filter(Boolean) };
}

/**
 * `file` → { ok, consegna } | { errore }. La prova dei test nuovi si riprende se è della stessa punta, altrimenti si
 * corre qui; quella scritta a mano nel file non vale mai. `prova` e `percorsi` sono iniettabili per i test.
 */
export function leggiConsegna(file, root, { prova = null, percorsi = null, log = (s) => console.error(s) } = {}) {
  let testo;
  try {
    if (statSync(resolve(file)).size > C.MAX_BYTE) return { errore: `${file} supera ${C.MAX_BYTE / 1024} KB: la consegna è una tabella, non un racconto` };
    testo = readFileSync(resolve(file), 'utf8');
  } catch (e) { return { errore: `non leggo ${file} (${e.code || e.message})` }; }
  let c;
  try { c = JSON.parse(testo); } catch (e) { return { errore: `${file} non è JSON valido (${e.message}): serve ${FORMA_CONSEGNA}` }; }
  if (c && typeof c === 'object' && !Array.isArray(c)) delete c.provaTest;
  const p = percorsi ? { percorsi } : percorsiDelRamo(root);
  if (p.errore) return { errore: `non so cosa tocca il ramo: ${p.errore}` };
  const motivi = C.validaConsegna(c, { interfaccia: C.lavoroDiInterfaccia(p.percorsi) });
  if (motivi.length) return { errore: `la consegna non è completa:\n- ${motivi.join('\n- ')}` };
  let esito = prova || esitoSalvato(root);
  if (!esito) {
    log('Prova dei test nuovi: per questa punta non ce n\'è una salvata (o dopo è cambiato del codice), la faccio qui, senza '
      + 'il lavoro e con: con degli spec nuovi dura minuti. La prossima volta lanciala dopo l\'ultimo commit di codice: '
      + 'la riga delle novità e i .md dopo non la invalidano.');
    // Il clone del server della prova di prima, o quello del lavoro server: la parte del server non si perde.
    esito = provaDelRamo(root, { log, server: cloneDellUltimaProva(root) });
    if (esito.errore) return { errore: `la prova dei test nuovi non è riuscita: ${esito.errore}` };
  }
  log(testoDelRamo(esito));
  return { ok: true, consegna: { versione: C.VERSIONE, ...c, provaTest: esito } };
}
