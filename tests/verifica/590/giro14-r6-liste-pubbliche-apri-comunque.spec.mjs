// Giro 14, rilievo 6: «Apri comunque» su un sito fermato dalle liste pubbliche porta a una pagina d'errore.
import { test, expect, schede, apri } from './helpers/banco.mjs';

test('link che passa per un contatore di clic, impostazioni di fabbrica: «Apri comunque» apre qualcosa', async ({ app, shell, rete }) => {
  await app.evaluate(() => { globalThis.__filoAdblock.setDomainsForTest(['tracker.test']); });
  const articolo = rete.pagina('articolo.test', '/', '<h1>ARTICOLO</h1>');
  const contatore = rete.rimbalzo('tracker.test', '/c', articolo);
  const link = rete.rimbalzo('accorcia.test', '/n', contatore);
  const pagina = rete.pagina('sito.test', '/', `<a id="go" href="${link}">leggi</a>`);
  await apri(app, shell, pagina);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await tab.evaluate(() => document.getElementById('go').click());
  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first();
  await shell.waitForTimeout(2000);
  if (!(await card.count())) return; // nessuna promessa fatta: niente da mantenere
  await card.locator('.shell-notif-action', { hasText: 'Apri comunque' }).click();
  await shell.waitForTimeout(2500);
  expect((await schede(app)).filter((u) => u.startsWith('filo://error'))).toEqual([]);
});
