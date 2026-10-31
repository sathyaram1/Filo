// Esplorazione della verifica #1956: aspetto chiaro e scuro, recap, tasto destro sull'intestazione, stress del filtro.
import { mkdirSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const NOVITA = 'filo://novita/novita.html';
const SHOTS = 'tests/.shots';

async function apri(openTab, url = NOVITA) {
  const page = await openTab(url);
  await page.waitForFunction(() => document.body.dataset.pronto === '1', null, { timeout: 10_000 });
  return page;
}

test('esplora aspetto e stress', async ({ app, openTab }) => {
  mkdirSync(SHOTS, { recursive: true });
  const page = await apri(openTab);
  await page.screenshot({ path: `${SHOTS}/v1956-chiaro.png` });
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' });
  });
  const scura = await apri(openTab);
  await scura.screenshot({ path: `${SHOTS}/v1956-scuro.png` });
  await scura.locator('#cerca').fill('tradzione');
  await expect(scura.locator('#avviso')).toBeVisible();
  await scura.screenshot({ path: `${SHOTS}/v1956-scuro-cerca.png` });
  await scura.setViewportSize({ width: 600, height: 700 }).catch(() => {});

  // tasto destro sull'intestazione
  await scura.locator('#cerca').fill('');
  await scura.waitForTimeout(300);
  await scura.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await scura.locator('.nv-intesta').first().click({ button: 'right' });
  const m = menuDi(scura);
  await expect(m.voce('Copia tutta la versione')).toBeVisible();
  await scura.screenshot({ path: `${SHOTS}/v1956-menu-testa.png` });
  await scura.keyboard.press('Escape');

  await scura.locator('.nv-riga').first().click({ button: 'right' });
  await expect(m.voce('Copia il testo')).toBeVisible();
  await scura.screenshot({ path: `${SHOTS}/v1956-menu-riga.png` });
  await scura.keyboard.press('Escape');

  // stress
  for (const q of ['😀', 'a'.repeat(400), '   ', '<img src=x onerror=window.__x=1>', '"traduzione"']) {
    await scura.locator('#cerca').fill(q);
    await scura.waitForTimeout(250);
    console.log(JSON.stringify(q.slice(0, 15)), await scura.locator('#conta').textContent(), (await scura.locator('#vuoto').textContent()).slice(0, 80));
  }
  expect(await scura.evaluate(() => window.__x)).toBeUndefined();
  await scura.locator('#cerca').fill('a'.repeat(400));
  await scura.waitForTimeout(250);
  await scura.screenshot({ path: `${SHOTS}/v1956-lungo.png` });

  // tastiera: freccia giù dal campo, Ctrl+C copia la riga
  await scura.locator('#cerca').fill('');
  await scura.waitForTimeout(250);
  await scura.locator('#cerca').press('ArrowDown');
  await scura.keyboard.press('ArrowDown');
  await scura.keyboard.press('Control+c');
  const copiato = await app.evaluate(({ clipboard }) => clipboard.readText());
  const seconda = await scura.locator('.nv-riga').nth(1).textContent();
  console.log('copiato', copiato.slice(0, 60), '| seconda', seconda.slice(0, 60));
  expect(copiato).toBe(seconda);
});

test('esplora recap', async ({ app, openTab }) => {
  mkdirSync(SHOTS, { recursive: true });
  const home = await openTab('filo://newtab/');
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.setRaw(globalThis.SN_CONST.STORAGE_KEYS.LAST_SEEN_VERSION, '0.2.250');
  });
  await home.reload();
  await expect(home.locator('#recapOverlay')).toBeVisible();
  await home.waitForTimeout(600);
  await home.screenshot({ path: `${SHOTS}/v1956-recap.png` });
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' });
    await globalThis.SN_STORAGE.setRaw(globalThis.SN_CONST.STORAGE_KEYS.LAST_SEEN_VERSION, '0.2.250');
  });
  await home.reload();
  await expect(home.locator('#recapOverlay')).toBeVisible();
  await home.waitForTimeout(600);
  await home.screenshot({ path: `${SHOTS}/v1956-recap-scuro.png` });
});
