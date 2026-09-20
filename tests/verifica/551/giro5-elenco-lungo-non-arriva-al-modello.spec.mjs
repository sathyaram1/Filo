// Verifica #551 — giro 5. Filo elenca la cartella per trovare il file, il
// terminale gli consegna l'elenco intero, e poi due terzi dell'elenco vengono
// buttati via prima che il modello lo legga.
//
// Il terminale di Filo tiene fino a dodicimila caratteri dell'uscita di un
// comando. La busta con cui quell'uscita entra nel prompt ne tiene quattromila:
// il taglio è dichiarato, ma di un elenco di centoventi file al modello ne
// arrivano quarantatré, e il file che l'utente ha chiesto può essere fra quelli
// scartati. Filo risponde che non lo trova — la frase della segnalazione, per
// una strada che non passa dalla codifica.
//
// Il tetto della busta va almeno dove arriva quello del terminale: è il
// terminale che ha già deciso quanto vale la pena spendere, e spendere per
// catturare dodicimila caratteri per poi consegnarne quattromila è pagare due
// volte per non sapere.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('l’elenco di una cartella piena arriva al modello per intero', async () => {
  const { MAX_OUTPUT_CHARS } = require(resolve(RADICE, 'src/main/services/terminal.js'));
  require(resolve(RADICE, 'src/shared/contenutoEsterno.js'));
  const E = globalThis.SN_ESTERNO;

  // Il tetto della busta sta scritto dove l'uscita del comando viene preparata
  // per il modello: lo leggiamo da lì invece di ricopiarlo.
  const sorgente = readFileSync(resolve(RADICE, 'src/main/services/handlers.js'), 'utf8');
  const m = sorgente.match(/tipo:\s*'ESITO_COMANDO'[^\n]*max:\s*(\d+)/);
  expect(m, 'non si trova più il tetto della busta dell’uscita dei comandi').toBeTruthy();
  const tettoBusta = Number(m[1]);

  expect(
    tettoBusta,
    `il terminale conserva ${MAX_OUTPUT_CHARS} caratteri e la busta ne consegna al modello ${tettoBusta}`,
  ).toBeGreaterThanOrEqual(MAX_OUTPUT_CHARS);

  // E la conseguenza, misurata: un elenco di centoventi file.
  const elenco = Array.from({ length: 120 }, (_, i) =>
    `-rw-r--r--  1 mario mario   12345 12 mar 10:2${i % 10} SPECIFICHE SEO E METADATI — singolarita ${i}.txt`)
    .join('\n');
  const busta = E.imbusta({ tipo: 'ESITO_COMANDO', testo: elenco, conIntestazione: true, max: tettoBusta });
  const arrivate = busta.split('\n').filter((l) => l.startsWith('-rw')).length;
  expect(
    arrivate,
    `di ${elenco.split('\n').length} file elencati ne arrivano al modello ${arrivate}: il file chiesto può essere fra gli altri`,
  ).toBe(120);
});
