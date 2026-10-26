// Verifica #1589 giro 18. r4: un codice usa e getta fatto di lettere e cifre arriva al modello.
import { test, expect } from '../../fixtures/electron.mjs';
import { leggiInChat } from './giro18-aiuto.mjs';

test('r4 il codice di Steam Guard e quello da scrivere sulla TV non arrivano al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Posta di Steam', `<h1>Posta di Steam</h1>
    <p>Il tuo codice Steam Guard è 7K2F9</p>
    <p>Enter this code on your TV: WDJB-MJHT</p>`, 'dalla pagina Posta di Steam: riassumi');
  expect(mandato, 'la pagina è stata letta').toContain('Posta di Steam');
  expect(mandato).not.toContain('7K2F9');
  expect(mandato).not.toContain('WDJB-MJHT');
});
