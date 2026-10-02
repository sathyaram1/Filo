// Verifica #430 giro 4, rilievo 1: con l'anteprima spenta dalle Preferenze Filo continua a fotografare le schede,
// ad allargarle sotto quella davanti e a spiarne le pagine: spenta deve voler dire che non lavora.
import { test, expect } from '../../fixtures/electron.mjs';
import { pagina, schede, idDi } from './giro2-carta.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

test('anteprima spenta dalle Preferenze: nessuna foto delle schede, né lasciate né aperte dietro', async ({ app, shell, openTab, testServer }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForSelector('#tabPreviewEnabled');
  await expect(pref.locator('#tabPreviewEnabled')).toBeChecked();
  await pref.locator('#tabPreviewEnabled').uncheck();
  await expect.poll(async () => (await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' })))?.settings?.tabPreview?.enabled, { timeout: 5000 }).toBe(false);

  const dietro = testServer.html(pagina('#10b010', 'Dietro'));
  const uA = testServer.html(pagina('#e01010', 'Davanti', `<a id="vai" href="${dietro}">vai</a>`));
  await shell.evaluate((u) => window.filoShell.tabs.open(u), uA);
  const a = await idDi(app, (t) => t.url === uA);
  await pausa(500);
  const pA = app.windows().find((w) => w.url() === uA);
  await pA.click('#vai', { modifiers: ['Control'] });
  const d = await idDi(app, (t) => t.url === dietro);
  await pausa(3000);
  // Lasciata la scheda davanti per un'altra.
  const uB = testServer.html(pagina('#1030d0', 'Altra'));
  await shell.evaluate((u) => window.filoShell.tabs.open(u), uB);
  await idDi(app, (t) => t.url === uB);
  await pausa(4000);

  const stato = await app.evaluate(({ BrowserWindow }, ids) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return ids.map((id) => {
      const tab = t.tabs.find((x) => x.id === id);
      return { foto: !!t.anteprime.get(id), seguita: !!tab._anteprimaSegui };
    });
  }, [a, d]);
  console.log('SPENTA', JSON.stringify(stato));
  expect(stato).toEqual([{ foto: false, seguita: false }, { foto: false, seguita: false }]);
});
