// Verifica #1589 giro 18. r2: un codice usa e getta o di una porta con un nome fuori dagli elenchi arriva al modello.
import { test, expect } from '../../fixtures/electron.mjs';
import { leggiInChat } from './giro18-aiuto.mjs';

test('r2 i codici usa e getta con un aggettivo e i codici di apertura non arrivano al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Posta in arrivo', `<h1>Posta in arrivo</h1>
    <p>Il codice generato è 731842</p>
    <p>Codice richiesto: 590316</p>
    <p>Codice univoco: 268407</p>
    <p>Your requested code: 914725</p>
    <p>Codice di apertura: 6153</p>
    <p>Codice cantina 7092</p>
    <p>Codice del parcheggio: 3847</p>
    <p>Per disattivare l'allarme digita 5261</p>`, 'dalla pagina Posta in arrivo: riassumi');
  expect(mandato, 'la pagina è stata letta').toContain('Posta in arrivo');
  for (const v of ['731842', '590316', '268407', '914725', '6153', '7092', '3847', '5261']) expect(mandato).not.toContain(v);
});
