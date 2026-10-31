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
    const { MSG } = globalThis.SN_MSG;
    await globalThis.SN_HANDLE_MESSAGE({ type: MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { url: 'filo://preferences/preferences.html' });
  });
  await page.waitForTimeout(500);
  console.log('tema dal vivo', await page.evaluate(() => document.documentElement.dataset.snTheme));
  await page.reload();
  const scura = page;
  await scura.waitForFunction(() => document.body.dataset.pronto === '1');
  console.log('tema dopo reload', await page.evaluate(() => document.documentElement.dataset.snTheme));
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

test('esplora chat ?q', async ({ app, shell, openTab }) => {
  const nov = await apri(openTab);
  const home = await openTab('filo://newtab/');
  const r = await home.evaluate(() => chrome.runtime.sendMessage({
    type: window.SN_MSG.MSG.FILO_RUN_ACTION,
    action: { type: 'NAVIGA', url: 'filo://novita/novita.html?q=traduzione', etichetta: 'Novità' },
  }));
  console.log('esito', JSON.stringify(r).slice(0, 200));
  await new Promise((res) => setTimeout(res, 2500));
  const urls = app.windows().map((w) => w.url()).filter((u) => u.startsWith('filo://novita'));
  console.log('pagine novita', urls);
  for (const w of app.windows().filter((w) => w.url().startsWith('filo://novita'))) {
    console.log(w.url(), '->', await w.locator('#cerca').inputValue(), await w.locator('#conta').textContent());
  }
  const attiva = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean);
    const t = tm && tm.tabs.find((x) => x.id === tm.activeId);
    return t ? t.view.webContents.getURL() : '';
  });
  console.log('attiva', attiva);
});
