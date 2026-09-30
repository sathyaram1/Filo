// Verifica #590, giro 18, rilievo 2: un rimbalzo fermato dalla lista non svuota la scheda da cui parte
// quando il salto cambia la vista della scheda (modalità privacy fra siti diversi).

import { test, expect, lista, schede } from '../../helpers/reteFinta.mjs';

test('modalità privacy: un link verso un accorciatore che rimbalza sul sito della lista lascia la pagina di prima', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { security: { cookies: { mode: 'privacy' } } } }));
  await shell.waitForTimeout(500);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const corto = rete.rimbalzo('accorcia.test', '/r', bersaglio);
  const pagina = rete.pagina('sito.test', '/', `<h1>PAGINA</h1><a id="l" href="${corto}">link</a>`);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), pagina);
  await expect.poll(async () => (await schede(app)).includes(pagina), { timeout: 8000 }).toBe(true);
  await shell.waitForTimeout(800);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await tab.click('#l');
  await shell.waitForTimeout(3000);
  const caricate = await schede(app);
  expect(caricate.filter((u) => u.includes('blocked.test'))).toEqual([]);
  // La scheda mostra ancora qualcosa: la pagina da cui si è partiti (o la pagina «Sito bloccato»), non il vuoto.
  expect(caricate.filter((u) => u === '')).toEqual([]);
  expect(caricate.some((u) => u === pagina || /code=blocked/.test(u))).toBe(true);
});
