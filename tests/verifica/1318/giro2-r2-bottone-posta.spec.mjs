// Verifica #1318 giro 2, rilievo 2: il bottone della chat che riapre la mail chiesta senza «mailto:» riapre la mail,
// non una ricerca Google dell'indirizzo.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } });
});
test.afterEach(async ({ app }) => { await ripristina(app); });

test('r2 la mail chiesta senza «mailto:» si riapre dal suo bottone, che non porta su Google', async ({ app }) => {
  test.setTimeout(90_000);
  await app.evaluate(({ shell: s }) => { globalThis.__esterni = []; s.openExternal = async (u) => { globalThis.__esterni.push(String(u)); }; });
  await modelloFinto(app, [{ toolCalls: [{ id: 'p1', name: 'NAVIGA', arguments: JSON.stringify({ url: 'mario.rossi@esempio.it' }) }] }, { text: 'Ti ho aperto la mail.' }]);
  const page = await home(app);
  await chiedi(page, 'scrivi una mail a mario');
  await expect.poll(() => app.evaluate(() => globalThis.__esterni), { timeout: 15_000 }).toEqual(['mailto:mario.rossi@esempio.it']);

  const bottone = page.locator('a.dash-action-link-chip');
  await expect(bottone).toHaveCount(1, { timeout: 15_000 });
  await expect(bottone).not.toContainText('google');
  const prima = await schede(app);
  await bottone.evaluate((a) => a.click());
  await expect.poll(() => app.evaluate(() => globalThis.__esterni.length), { timeout: 8000 }).toBe(2);
  expect(await app.evaluate(() => globalThis.__esterni[1])).toBe('mailto:mario.rossi@esempio.it');
  expect((await schede(app)).filter((u) => !prima.includes(u)), 'nessuna ricerca dell\'indirizzo').toEqual([]);
});
