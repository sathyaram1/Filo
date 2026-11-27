// Verifica #2673.12, giro 2: il valore dentro un tag con attributi, o su una riga sua dentro la cella, non deve passare ai
// modelli, né dal pavimento (cancello dei modelli, ricerca) né dal correttore. Logica pura: niente finestra.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');
const C = require('../../../src/main/services/correttoreRiservati.js');

function nonPassa(testo, valore) {
  expect(P.oscuraTutto(testo), `pavimento: ${JSON.stringify(testo)}`).not.toContain(valore);
  expect(C.oscura(testo), `correttore: ${JSON.stringify(testo)}`).not.toContain(valore);
}

test('r1 il valore in un tag con una classe, uno stile o un collegamento resta coperto', () => {
  nonPassa('<span class="label">Password:</span> <span class="value">Nyckel!2024</span>', 'Nyckel!2024');
  nonPassa('<td class="k">Password</td>\n<td class="v">Nyckel!2024</td>', 'Nyckel!2024');
  nonPassa('<td>Password</td>\n<td class="mono">Nyckel!2024</td>', 'Nyckel!2024');
  nonPassa('Password: <span class="v">Nyckel!2024</span>', 'Nyckel!2024');
  nonPassa('<p>Password: <span style="font-family:monospace">Nyckel!2024</span></p>', 'Nyckel!2024');
  nonPassa('<p>Password: <a href="#">Nyckel!2024</a></p>', 'Nyckel!2024');
  nonPassa('<td>PIN</td><td class="num">4821</td>', '4821');
  nonPassa('<div class="k">Password</div><div class="v">Nyckel!2024</div>', 'Nyckel!2024');
});

test('r2 una cella con l\'etichetta e il valore su righe loro, rientrate, resta coperta', () => {
  nonPassa('<td>\n  Password\n</td>\n<td>\n  Nyckel!2024\n</td>', 'Nyckel!2024');
  nonPassa('<tr>\n  <td>\n    PIN\n  </td>\n  <td>\n    4821\n  </td>\n</tr>', '4821');
});
