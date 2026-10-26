// Verifica #1589 giro 17. r2: il codice di una cosa che si apre fuori dall'elenco (appartamento, serranda, bancomat, ascensore, building) arriva al modello.
import { test, expect } from '../../fixtures/electron.mjs';
import { leggiInChat } from './giro17-aiuto.mjs';

test('r2 i codici di appartamento, serranda, bancomat, ascensore e building, e uno con la forma di un anno, non arrivano al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Come entrare', `<h1>Come entrare</h1>
    <p>Il codice dell'appartamento è 7316.</p>
    <p>Codice della serranda: 5502</p>
    <p>Codice bancomat: 91827</p>
    <p>Codice ascensore: 6403</p>
    <p>building code 8812</p>
    <p>Per aprire il cancello digita 3958 sul tastierino.</p>
    <p>Il codice del cancello è 1990.</p>`, 'dalla pagina Come entrare: come entro?');
  expect(mandato, 'la pagina è stata letta').toContain('Come entrare');
  for (const s of ['7316', '5502', '91827', '6403', '8812', '3958', '1990']) expect(mandato, s).not.toContain(s);
});
