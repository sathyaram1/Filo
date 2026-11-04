// L'aiuto `home()` della chat finta torna la home che l'utente ha davanti, non la prima trovata per indirizzo (#877.2).
// La regola sta in tests/helpers/chatFinta.mjs; il riconoscimento della scheda in tests/helpers/schede.mjs.
import { test, expect } from './fixtures/electron.mjs';
import { home } from './helpers/chatFinta.mjs';

const schede = async (shell) => (await shell.evaluate(() => window.filoShell.tabs.snapshot())).tabs;

test('con due home aperte torna quella della scheda attiva, e quella chiesta per scheda', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  const avvio = await home(app);
  const [primaScheda] = await schede(shell);
  const aperta = await openTab('filo://newtab/');
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 10_000 });

  const trovata = await home(app);
  await trovata.locator('#input').fill('scritto nella home davanti');
  await expect(aperta.locator('#input')).toHaveValue('scritto nella home davanti');
  await expect(avvio.locator('#input')).toHaveValue('');

  const perScheda = await home(app, { scheda: primaScheda.id });
  await perScheda.locator('#input').fill('scritto nella home dell\'avvio');
  await expect(avvio.locator('#input')).toHaveValue('scritto nella home dell\'avvio');
  await expect(aperta.locator('#input')).toHaveValue('scritto nella home davanti');
});

test('con una sola home e un sito davanti torna ancora quella home', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const avvio = await home(app);
  await openTab(testServer.html('<title>sito</title><p>sito</p>'));
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 10_000 });
  expect(await home(app)).toBe(avvio);
});
