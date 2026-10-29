// #1433 giro 6, rilievo 3: nel catalogo del «+» il nome «Dimensione testo» è tagliato.
import { test, expect } from '../../fixtures/electron.mjs';
import { EDITOR, apriPannello } from '../../helpers/strumentiEditor.mjs';

test('r3 nel catalogo del «+» «Dimensione testo» si legge intero', async ({ openTab }) => {
  const ed = await openTab(EDITOR);
  await ed.waitForSelector('.pd-elemento[data-elemento="word-count"]', { state: 'attached' });
  await apriPannello(ed);
  await ed.click('.pd-piu');
  const nome = ed.locator('.pd-catalogo .pd-voce[data-elemento="text-size"] .pd-voce-nome');
  await expect(nome).toBeVisible();
  expect(await nome.evaluate((n) => n.scrollWidth <= n.clientWidth), '«Dimensione testo» tagliato').toBe(true);
});
