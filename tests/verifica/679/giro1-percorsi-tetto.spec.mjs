// Giro 1 di verifica del #679 — quanti percorsi noti il prompt dell'Aiuto usa
// davvero. La segnalazione chiede di abbassare il tetto «se il prompt ne usa
// meno di 50», e di guardare quanti ne usa prima di scegliere il numero.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'pathsSafety.js'));
require(join(ROOT, 'src', 'shared', 'paths.js'));
const S = globalThis.SN_PATHS_SAFETY;
const P = globalThis.SN_PATHS;

// Un percorso come quelli che la raccolta registra davvero: un intento in una
// riga e una manciata di clic con l'etichetta dell'elemento.
function percorso(i, passi, lunghezzaEtichetta) {
  return {
    domain: 'esempio.it',
    intent: `compito numero ${i} da svolgere sul sito`,
    initialUrl: `/area${i}/pagina`,
    steps: Array.from({ length: passi }, (_, k) => ({ action: 'click', selector: `bottone ${i}-${k} `.padEnd(lunghezzaEtichetta, 'x') })),
    success: true,
  };
}

function quantiCeNeStanno(passi, lunghezzaEtichetta) {
  const tanti = Array.from({ length: 300 }, (_, i) => percorso(i, passi, lunghezzaEtichetta));
  return (S.formatKnownPathsForPrompt(tanti).match(/^## "/gm) || []).length;
}

test('il tetto dei percorsi chiesti non sta sotto quelli che il prompt userebbe', () => {
  // Tre clic con etichette brevi e otto con etichette lunghe: le due forme
  // normali di quello che l'utente insegna a Filo su un sito.
  const corti = quantiCeNeStanno(3, 14);
  const medi = quantiCeNeStanno(8, 30);
  expect(corti, `premessa della misura (corti=${corti})`).toBeGreaterThan(50);
  expect(medi, `premessa della misura (medi=${medi})`).toBeGreaterThan(40);
  expect(P.rest.DEFAULT_PAGE_SIZE,
    `il prompt tiene ${medi} percorsi di media lunghezza (${corti} se corti), ma se ne chiedono ${P.rest.DEFAULT_PAGE_SIZE}: `
    + 'su un sito con molte strade registrate l’Aiuto ne vede meno di quante ne userebbe').toBeGreaterThanOrEqual(50);
});
