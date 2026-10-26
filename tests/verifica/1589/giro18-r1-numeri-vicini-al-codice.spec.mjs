// Verifica #1589 giro 18. r1: un numero qualunque nella frase che dice «code» o «codice» sparisce, e con lui ogni sua copia nella pagina.
import { test, expect } from '../../fixtures/electron.mjs';
import { leggiInChat } from './giro18-aiuto.mjs';

test('r1 in un tutorial la porta e l\'indirizzo locale arrivano al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const mandato = await leggiInChat({ app, openTab, testServer }, 'Avviare il server', `<h1>Avviare il server</h1>
    <p>Start the server with npm start. The code uses port 3000.</p>
    <p>Then open http://localhost:3000 in the browser.</p>
    <p>Il codice è stato scaricato 48291 volte.</p>
    <p>My code returns 1024 instead of 2048.</p>`, 'dalla pagina Avviare il server: su che porta gira?');
  expect(mandato, 'la pagina è stata letta').toContain('Avviare il server');
  expect(mandato).toContain('localhost:3000');
  expect(mandato).toContain('port 3000');
  expect(mandato).toContain('scaricato 48291 volte');
  expect(mandato).toContain('returns 1024');
});

test('r1 una ricerca sul numero di una porta o sul PIN di serie di un dispositivo parte', async ({ app }) => {
  const bloccate = await app.evaluate(() => ['node code port 3000 already in use', 'PIN predefinito 0000 cuffie bluetooth']
    .filter((q) => globalThis.SN_PAVIMENTO.trova(q).length));
  expect(bloccate).toEqual([]);
});
