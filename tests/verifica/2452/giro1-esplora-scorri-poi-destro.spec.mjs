// Esplorazione #2452: il tasto destro su una voce fuori vista (Playwright o l'utente la porta sotto il puntatore) apre il menu.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

const pronta = (page) => page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });

test('Preferenze in fondo: tasto destro sulla casella in cima apre il menu e «Rimetti di serie» funziona', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ tabPreview: { enabled: false } }));
  const page = await openTab('filo://preferences/preferences.html');
  const casella = page.locator('#tabPreviewEnabled');
  await pronta(page);
  await expect(casella).not.toBeChecked({ timeout: 10_000 });
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
    await page.locator('label', { has: casella }).click({ button: 'right' });
    await expect(menuDi(page).principale).toBeVisible({ timeout: 5_000 });
    await page.evaluate(() => new Promise((ok) => setTimeout(ok, 400)));
    await expect(menuDi(page).principale).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menuDi(page).principale).toHaveCount(0);
  }
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.locator('label', { has: casella }).click({ button: 'right' });
  await menuDi(page).voce('Rimetti di serie').first().click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).tabPreview.enabled)).toBe(true);
});

test('Preferenze: rotella e subito tasto destro, il menu resta aperto', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await pronta(page);
  await page.mouse.move(300, 300);
  await page.mouse.wheel(0, 300);
  await page.mouse.click(300, 300, { button: 'right' });
  await expect(menuDi(page).principale).toBeVisible({ timeout: 5_000 });
  await page.evaluate(() => new Promise((ok) => setTimeout(ok, 600)));
  const aperto = await menuDi(page).principale.count();
  console.log('rotella+destro, menu aperto dopo 600ms:', aperto, 'scrollY', await page.evaluate(() => window.scrollY));
});

test('Preferenze: menu aperto, poi lo scorrimento dell’utente lo chiude', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await pronta(page);
  await page.locator('label', { has: page.locator('#tabPreviewEnabled') }).click({ button: 'right' });
  await expect(menuDi(page).principale).toBeVisible({ timeout: 5_000 });
  await page.evaluate(() => new Promise((ok) => setTimeout(ok, 300)));
  await page.mouse.move(20, 400);
  await page.mouse.wheel(0, 400);
  await expect(menuDi(page).principale).toHaveCount(0, { timeout: 3_000 });
});

test.describe('nello strato', () => {
  test.use({ stratoDelMenu: true });
  test('sito scorso in fondo: tasto destro su un elemento in cima apre il menu nello strato e resta', async ({ app, openTab, testServer }) => {
    await paginaDelloStrato(app);
    await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
    const page = await testServer.openReady(openTab, '<!doctype html><body style="margin:0;height:5000px"><p id="t" style="margin:0;padding:20px">Titolo in cima</p></body>');
    await pronta(page);
    await page.evaluate(() => window.scrollTo({ top: 4000, behavior: 'instant' }));
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
    await page.locator('#t').click({ button: 'right' });
    await expect.poll(async () => (await statoDelloStrato(app))?.aperto).toBe(true);
    await page.evaluate(() => new Promise((ok) => setTimeout(ok, 400)));
    expect((await statoDelloStrato(app)).aperto).toBe(true);
  });
});
