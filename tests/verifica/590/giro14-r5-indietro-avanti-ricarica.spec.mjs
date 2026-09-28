// Giro 14, rilievo 5: indietro e ricarica rimettono davanti un sito appena messo in lista, senza dirlo.
import { test, expect, lista, schede, apri, idAttiva, contaAvvisi } from './helpers/banco.mjs';

test('indietro verso un sito messo in lista nel frattempo: fermato e detto', async ({ app, shell, rete }) => {
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const altro = rete.pagina('sito.test', '/', '<h1>ALTRO</h1>');
  await apri(app, shell, sito);
  const id = await idAttiva(app);
  await shell.evaluate(([i, u]) => window.filoShell.tabs.navigate(i, u), [id, altro]);
  await expect.poll(async () => (await schede(app)).some((u) => u.includes('sito.test')), { timeout: 6000 }).toBe(true);
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  await shell.evaluate((i) => window.filoShell.tabs.back(i), id);
  await shell.waitForTimeout(2000);
  expect((await schede(app)).filter((u) => u.includes('blocked.test'))).toEqual([]);
  expect((await avvisi()).length).toBeGreaterThan(0);
});

test('ricarica di un sito messo in lista mentre lo si guarda: la notifica lo dice', async ({ app, shell, rete }) => {
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await apri(app, shell, sito);
  const id = await idAttiva(app);
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  await shell.evaluate((i) => window.filoShell.tabs.reload(i), id);
  await shell.waitForTimeout(2000);
  expect((await avvisi()).length).toBeGreaterThan(0);
});
