// #1318 giro 4, rilievo 3: il bottone in chat di un indirizzo scritto senza http (localhost con la porta) riapre la
// pagina senza chiedere un OK «non ho potuto controllare»: la pagina l'assistente l'ha appena aperta.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const naviga = (id, url, etichetta) => ({ id, name: 'NAVIGA', arguments: JSON.stringify({ url, etichetta }) });
const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } });
});

test.afterEach(async ({ app }) => { await ripristina(app); });

test('r3 il bottone di localhost:porta riapre la pagina senza chiedere l\'OK', async ({ app, testServer }) => {
  test.setTimeout(90_000);
  const scritto = testServer.html('<title>Server di sviluppo</title><p>pronto</p>').replace('http://127.0.0.1', 'localhost');
  const pagina = `http://${scritto}`;
  await modelloFinto(app, [{ text: 'Apro il server.', toolCalls: [naviga('n1', scritto, 'Server di sviluppo')] }, { text: 'Fatto.' }]);
  const page = await home(app);
  await chiedi(page, `apri ${scritto}`);
  await expect.poll(async () => (await schede(app)).filter((u) => u === pagina).length, { timeout: 15_000 }).toBe(1);

  const bottone = page.locator('a.dash-action-link-chip');
  await expect(bottone).toHaveCount(1, { timeout: 15_000 });
  await expect(bottone).toHaveAttribute('href', pagina);
  await page.evaluate(() => {
    window.__ok = [];
    if (window.SN_CONFIRM_UI) window.SN_CONFIRM_UI.confirm = async (o) => { window.__ok.push(String(o && o.text)); return false; };
  });
  await bottone.evaluate((a) => a.click());
  await expect.poll(async () => (await schede(app)).filter((u) => u === pagina).length, { timeout: 15_000 }).toBe(2);
  expect(await page.evaluate(() => window.__ok), 'nessun OK chiesto per la pagina appena aperta').toEqual([]);
});
