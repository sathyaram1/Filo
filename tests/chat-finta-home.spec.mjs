// L'aiuto `home()` della chat finta torna la home che l'utente ha davanti, non la prima trovata per indirizzo (#877.2).
// La regola sta in tests/helpers/chatFinta.mjs; il riconoscimento della scheda in tests/helpers/schede.mjs.
import { test, expect } from './fixtures/electron.mjs';
import { home } from './helpers/chatFinta.mjs';

const schede = async (shell) => (await shell.evaluate(() => window.filoShell.tabs.snapshot())).tabs;
// Un segno nel documento, non il testo del campo: le home si passano la bozza, e il campo si legge uguale in tutte e due.
const segna = (page, s) => page.evaluate((v) => { window.__segno = v; }, s);
const segno = (page) => page.evaluate(() => window.__segno || null);

test('con due home aperte torna quella della scheda attiva, e quella chiesta per scheda', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  const avvio = await home(app);
  await segna(avvio, 'avvio');
  const [primaScheda] = await schede(shell);
  const aperta = await openTab('filo://newtab/');
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 10_000 });
  await segna(aperta, 'aperta');

  expect(await segno(await home(app))).toBe('aperta');
  expect(await segno(await home(app, { scheda: primaScheda.id }))).toBe('avvio');
});

test('con una sola home e un sito davanti torna ancora quella home', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const avvio = await home(app);
  await segna(avvio, 'avvio');
  await openTab(testServer.html('<title>sito</title><p>sito</p>'));
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 10_000 });
  expect(await segno(await home(app))).toBe('avvio');
});
