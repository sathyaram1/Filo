// Verifica #2673.12, giro 1: un'etichetta della password scritta in HTML non deve lasciar passare il valore ai modelli,
// né dal pavimento (cancello dei modelli, ricerca) né dal correttore. Logica pura: niente finestra.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');
const C = require('../../../src/main/services/correttoreRiservati.js');

function nonPassa(testo, valore) {
  expect(P.oscuraTutto(testo), `pavimento: ${JSON.stringify(testo)}`).not.toContain(valore);
  expect(C.oscura(testo), `correttore: ${JSON.stringify(testo)}`).not.toContain(valore);
}

test('r1 una tabella copiata dal sorgente, con le celle su righe diverse, copre la password e il PIN', () => {
  nonPassa('<td>Password</td>\n<td>Nyckel!2024</td>', 'Nyckel!2024');
  nonPassa('<th>PIN</th>\n<td>4821</td>', '4821');
  nonPassa('<td>PIN:</td>\n    <td>4821</td>', '4821');
  nonPassa('<table>\n  <tr>\n    <td>Rete</td>\n    <td>Casa</td>\n  </tr>\n  <tr>\n    <td>Password</td>\n    <td>Nyckel!2024</td>\n  </tr>\n</table>', 'Nyckel!2024');
});

test('r2 le grafie HTML rare fra etichetta e valore non lasciano passare la password', () => {
  nonPassa('<b>Password</b>&#58; Nyckel!2024', 'Nyckel!2024');
  nonPassa('<b>Password&colon;</b> Nyckel!2024', 'Nyckel!2024');
  nonPassa('<b>Password:</b> <!-- x --> Nyckel!2024', 'Nyckel!2024');
  nonPassa('<b >Password:</ b> Nyckel!2024', 'Nyckel!2024');
});
