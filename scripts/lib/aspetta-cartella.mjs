// L'attesa in primo piano del worker sui suoi comandi in sottofondo (#2185): in cloud `sleep` e i cicli scritti nella
// shell chiedono un permesso che nessuno approva, uno script del canale no. Regole: _contratto-worker.md § Comandi lunghi.
// Unit test: tests/unit/aspettaCartella.test.mjs.

import { USCITA_LAVORO_VIVO, testoLavoroVivo } from './branch-integrity.mjs';

// Sotto i due minuti del timeout predefinito di una chiamata Bash: chi la lancia non deve dimensionarlo.
export const FETTA_MS = 100 * 1000;
export const PASSO_MS = 5 * 1000;
export const USCITA_LIBERA = 0;

/** Aspetta che `controlla()` non veda più lavoro vivo, al massimo una fetta. @returns {{ uscita, esito, testo }} */
export async function aspettaCartella({ controlla, sleep, adesso = Date.now, fetta = FETTA_MS, passo = PASSO_MS }) {
  const fine = adesso() + fetta;
  for (;;) {
    const esito = controlla();
    if (!esito.vivo) return { uscita: USCITA_LIBERA, esito, testo: testoAttesa(esito, USCITA_LIBERA, fetta) };
    const resta = fine - adesso();
    if (resta <= 0) return { uscita: USCITA_LAVORO_VIVO, esito, testo: testoAttesa(esito, USCITA_LAVORO_VIVO, fetta) };
    await sleep(Math.min(passo, resta));
  }
}

/** PURA. */
export function testoAttesa(esito, uscita, fetta = FETTA_MS) {
  if (uscita === USCITA_LIBERA) {
    return esito && esito.processiVisti === false
      ? 'Qui i processi non si leggono: controlla da te che i comandi in sottofondo siano finiti, poi prosegui.'
      : 'Finito: nessun tuo processo lavora più nella cartella. Leggi l’esito dei comandi in sottofondo e prosegui.';
  }
  return `${testoLavoroVivo(esito, 'finito di aspettare')} Rilancia lo stesso comando, subito: ogni chiamata aspetta al massimo ${Math.round(fetta / 1000)} secondi.`;
}
