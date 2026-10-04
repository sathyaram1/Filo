// #870 giro 1, rilievo 2: a sinistra ci va anche «un lavoro lungo in corso». Filo che lavora a una
// risposta lunga in un'altra scheda è il lavoro lungo più comune: la home deve mostrarlo come carta.
import { test, expect } from '../../fixtures/electron.mjs';
import { homeTab, modelloFinto } from './_comune.mjs';

test('mentre Filo lavora a lungo in un’altra scheda, la home lo mostra a sinistra', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const a = await homeTab(app);
  await modelloFinto(app, [{ testo: 'Ecco il confronto fra i tre preventivi.' }], 20_000);
  await a.locator('#input').fill('confronta i tre preventivi che ti ho mandato');
  await a.locator('#sendBtn').click();
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  const b = await homeTab(app, [a]);
  await expect(b.locator('#accade .dash-carta')).not.toHaveCount(0, { timeout: 8_000 });
});
