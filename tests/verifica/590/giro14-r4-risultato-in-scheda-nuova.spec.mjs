// Giro 14, rilievo 4: un risultato di ricerca che rimbalza arriva cliccato, non aperto in una scheda nuova.
import { test, expect, lista, schede, apri } from './helpers/banco.mjs';

test('il risultato aperto in una scheda nuova arriva come quello cliccato', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO CERCATO</h1>');
  const r = rete.rimbalzo('accorcia.test', '/r', bersaglio);
  const risultati = rete.pagina('www.bing.com', '/search', `<a id="nuova" target="_blank" href="${r}">risultato</a> <a id="stessa" href="${r}">risultato</a>`);
  await apri(app, shell, risultati);
  const tab = app.windows().find((w) => w.url().includes('www.bing.com'));
  await tab.evaluate(() => document.getElementById('stessa').click());
  await expect.poll(async () => (await schede(app)).some((u) => u.includes('blocked.test')), { timeout: 6000 }).toBe(true);

  await apri(app, shell, risultati);
  const tab2 = app.windows().find((w) => w.url().includes('www.bing.com'));
  await tab2.evaluate(() => document.getElementById('nuova').click());
  await expect.poll(async () => (await schede(app)).filter((u) => u.includes('blocked.test')).length, { timeout: 6000 }).toBe(2);
});
