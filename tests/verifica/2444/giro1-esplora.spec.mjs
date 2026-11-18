// #2444 giro 1 — un tasto destro dato su una pagina di Filo prima che il suo menu ascolti si rigioca quando ascolta.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

// Le impostazioni del content script arrivano tardi: la finestra in cui il menu non ascolta ancora si allarga a `ms`.
async function rallentaImpostazioni(app, ms) {
  await app.evaluate(({ ipcMain }, ritardo) => {
    const mappa = ipcMain._invokeHandlers;
    const orig = globalThis.__verificaOrigMessage || mappa.get('filo:message');
    globalThis.__verificaOrigMessage = orig;
    mappa.set('filo:message', async (e, msg, ...resto) => {
      if (msg && msg.type === 'get_settings' && ritardo > 0) await new Promise((r) => setTimeout(r, ritardo));
      return orig(e, msg, ...resto);
    });
  }, ms);
}

const pronta = (page) => page.evaluate(() => document.documentElement.dataset.filoContentReady === '1');

for (const { nome, url, casella } of [
  { nome: 'Preferenze', url: 'filo://preferences/preferences.html', casella: '#tabPreviewEnabled' },
  { nome: 'Modelli', url: 'filo://options/options.html', casella: '#useDefaultModels' },
]) {
  test(`${nome}: il tasto destro dato prima che il menu ascolti apre il menu della voce`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    await rallentaImpostazioni(app, 1500);
    const page = await openTab(url);
    const voce = page.locator('label', { has: page.locator(casella) });
    await expect(voce).toBeVisible({ timeout: 10_000 });
    expect(await pronta(page)).toBe(false);
    await voce.click({ button: 'right' });
    expect(await pronta(page)).toBe(false);
    await expect(menuDi(page).principale).toBeVisible({ timeout: 8_000 });
    await expect(menuDi(page).voce('Rimetti di serie').first()).toBeVisible();
    await page.screenshot({ path: `tests/.shots/2444-${nome}-rigioco.png` });
  });
}

test('Preferenze: due tasti destri prima che il menu ascolti aprono un menu solo, dove si è cliccato per ultimo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await rallentaImpostazioni(app, 1500);
  const page = await openTab('filo://preferences/preferences.html');
  const voce = page.locator('label', { has: page.locator('#tabPreviewEnabled') });
  await expect(voce).toBeVisible({ timeout: 10_000 });
  await page.mouse.click(30, 30, { button: 'right' });
  const box = await voce.boundingBox();
  await voce.click({ button: 'right' });
  expect(await pronta(page)).toBe(false);
  await expect(menuDi(page).principale).toBeVisible({ timeout: 8_000 });
  await expect(menuDi(page).principale).toHaveCount(1);
  await expect(menuDi(page).voce('Rimetti di serie').first()).toBeVisible();
  const m = await menuDi(page).principale.boundingBox();
  expect(Math.abs(m.y - box.y)).toBeLessThan(300);
});

test('Preferenze: un tasto destro e poi un clic sinistro altrove prima che il menu ascolti non apre il menu dopo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await rallentaImpostazioni(app, 1500);
  const page = await openTab('filo://preferences/preferences.html');
  const voce = page.locator('label', { has: page.locator('#tabPreviewEnabled') });
  await expect(voce).toBeVisible({ timeout: 10_000 });
  await voce.click({ button: 'right' });
  await page.mouse.click(5, 300);
  expect(await pronta(page)).toBe(false);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });
  await page.waitForTimeout(500);
  expect(await menuDi(page).principale.count()).toBe(0);
});

test('Preferenze: il tasto Menu della tastiera dato prima che il menu ascolti apre il menu', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await rallentaImpostazioni(app, 1500);
  const page = await openTab('filo://preferences/preferences.html');
  await expect(page.locator('#tabPreviewEnabled')).toBeAttached({ timeout: 10_000 });
  await page.locator('#tabPreviewEnabled').focus();
  await page.keyboard.press('ContextMenu');
  expect(await pronta(page)).toBe(false);
  await expect(menuDi(page).principale).toBeVisible({ timeout: 8_000 });
});
