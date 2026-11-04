// Verifica #1129 giro 1: il menu Impostazioni prepara la voce più usata; prove avversariali.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuAperto } from '../../helpers/barra.mjs';

test.use({ envInPiu: { FILO_PREPARA_IMPOSTAZIONI: '1' } });

const PREFERENZE = 'filo://preferences/preferences.html';

const vive = (app, u) => app.evaluate(({ webContents }, x) =>
  webContents.getAllWebContents().filter((w) => !w.isDestroyed() && w.getURL().startsWith(x)).length, u);

const menuVisibile = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .some((c) => c.isVisible() && decodeURIComponent(c.webContents.getURL()).includes('popupApi')));

async function apri(shell, app) {
  await shell.evaluate(() => document.getElementById('nav-settings').click());
  const menu = await menuAperto(app);
  expect(menu, 'il menu Impostazioni non si è aperto').toBeTruthy();
  await expect(menu.locator('.menu')).toContainText('Preferenze');
  return menu;
}

const clicVoce = (menu, t) => menu.evaluate((x) => {
  [...document.querySelectorAll('button.item')].find((b) => b.textContent.includes(x)).click();
}, t).catch(() => {});

const davanti = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
  const t = tm.tabs.find((x) => x.id === tm.activeId);
  if (!t) return null;
  const wc = t.view.webContents;
  const b = t.view.getBounds();
  return { url: t.url, title: t.title, loading: wc.isLoading(), visibile: t.view.getVisible(), w: b.width, h: b.height, wcUrl: wc.getURL() };
});

test('il menu resta aperto mentre la pagina preparata finisce di caricarsi', async ({ app, shell }) => {
  await apri(shell, app);
  await expect.poll(() => vive(app, PREFERENZE), { timeout: 15_000 }).toBe(1);
  await expect.poll(() => app.evaluate(({ webContents }, u) => webContents.getAllWebContents()
    .some((w) => w.getURL().startsWith(u) && !w.isLoading()), PREFERENZE), { timeout: 15_000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 1500));
  expect(await menuVisibile(app), 'il menu si è chiuso da solo mentre si preparava la pagina').toBe(true);
});

test('Preferenze consegnata: davanti, grande come la scheda, titolo giusto, prende i tasti', async ({ app, shell }) => {
  const menu = await apri(shell, app);
  await expect.poll(() => app.evaluate(({ webContents }, u) => webContents.getAllWebContents()
    .some((w) => w.getURL().startsWith(u) && !w.isLoading()), PREFERENZE), { timeout: 15_000 }).toBe(true);
  const prima = await davanti(app);
  await clicVoce(menu, 'Preferenze');
  await expect.poll(async () => (await davanti(app))?.url, { timeout: 5000 }).toContain('preferences');
  const d = await davanti(app);
  expect(d.visibile).toBe(true);
  expect(d.w).toBe(prima.w);
  expect(d.h).toBe(prima.h);
  await expect.poll(async () => (await davanti(app)).title, { timeout: 5000 }).not.toMatch(/^filo:|^$/);
  expect(await vive(app, PREFERENZE)).toBe(1);
  // La pagina consegnata ha la tastiera.
  const fuoco = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return t.view.webContents.isFocused();
  });
  expect(fuoco, 'la pagina consegnata non ha la tastiera').toBe(true);
  const pag = app.windows().find((w) => w.url().startsWith(PREFERENZE));
  await pag.screenshot({ path: 'tests/.shots/1129-consegnata.png' });
});

test('aperto e chiuso in fretta più volte, e chiuso cliccando fuori: nessuna vista resta viva', async ({ app, shell }) => {
  const base = await app.evaluate(({ webContents }) => webContents.getAllWebContents().length);
  for (let k = 0; k < 6; k++) {
    const menu = await apri(shell, app);
    if (k % 2) await menu.keyboard.press('Escape');
    else await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).focus());
    await new Promise((r) => setTimeout(r, k * 120));
  }
  await expect.poll(() => menuVisibile(app), { timeout: 4000 }).toBe(false);
  await expect.poll(() => vive(app, PREFERENZE), { timeout: 5000 }).toBe(0);
  await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().length), { timeout: 5000 }).toBeLessThanOrEqual(base + 1);
});

test('scelta subito, a pagina ancora in caricamento: arriva caricata e una sola', async ({ app, shell }) => {
  const menu = await apri(shell, app);
  await clicVoce(menu, 'Preferenze');
  await expect.poll(async () => { const d = await davanti(app); return d && d.url.includes('preferences') && !d.loading; }, { timeout: 15_000 }).toBe(true);
  expect(await vive(app, PREFERENZE)).toBe(1);
  const pag = app.windows().find((w) => w.url().startsWith(PREFERENZE));
  await expect(pag.locator('body')).not.toBeEmpty();
});

test('finestra incognito: la voce Preferenze dal suo menu apre la pagina nella sua finestra', async ({ app, shell }) => {
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)), { timeout: 10_000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 1500));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoIncognito).webContents
    .executeJavaScript("document.getElementById('nav-settings').click()"));
  const menu = await menuAperto(app);
  expect(menu).toBeTruthy();
  await new Promise((r) => setTimeout(r, 2500));
  expect(await menuVisibile(app), 'il menu in incognito si è chiuso da solo').toBe(true);
  await clicVoce(menu, 'Preferenze');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return t && t.url.includes('preferences') && !t.view.webContents.isLoading() && t.view.getVisible();
  }), { timeout: 15_000 }).toBe(true);
  const normale = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.tabs.some((t) => t.url.includes('preferences')));
  expect(normale, 'la pagina è finita nella finestra normale').toBe(false);
});
