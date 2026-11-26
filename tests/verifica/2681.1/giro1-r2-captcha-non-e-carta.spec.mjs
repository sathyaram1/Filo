// Verifica #2681.1, giro 1: il campo del captcha che un sito tedesco chiama «Sicherheitscode» non è una carta.
// Su una pagina senza https l'avviso del sito sospetto non deve dire che la pagina chiede i dati di pagamento.

import { test, expect } from '../../fixtures/electron.mjs';
import { copertura } from '../../helpers/avvisoSito.mjs';

const pagina = `<!doctype html><html><head><title>Kontakt</title></head><body><h1>Kontakt</h1>
  <form><div><label for="n">Name</label> <input id="n"></div>
  <div><label for="m">Nachricht</label> <textarea id="m"></textarea></div>
  <div><img alt="Captcha" width="120" height="40" style="background:#ccc"></div>
  <div><label for="c">Sicherheitscode</label> <input id="c"></div>
  <button type="button">Senden</button></form></body></html>`;

test('r2 un modulo di contatto col captcha «Sicherheitscode» si usa senza l’avviso dei dati di pagamento', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina);
  await page.fill('#n', 'Anna');
  const fine = Date.now() + 8_000;
  let coperta = false;
  while (Date.now() < fine && !coperta) {
    coperta = (await copertura(app).catch(() => null))?.coperta === true;
    await new Promise((r) => setTimeout(r, 200));
  }
  expect(coperta, 'la pagina del modulo di contatto è stata coperta dall’avviso del sito sospetto').toBe(false);
});
