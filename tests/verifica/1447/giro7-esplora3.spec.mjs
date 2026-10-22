// Giro 7, esplorazione 3: cosa resta sul disco di quello che si scrive in incognito; «propio» scritto tre volte.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8"><title>INCO_CORR</title><body><div id="log"></div>
  <textarea id="ta" lang="it" style="width:700px;height:80px;font:20px monospace"></textarea>
  <script>document.getElementById('ta').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const p = document.createElement('p'); p.textContent = e.target.value; document.getElementById('log').appendChild(p); e.target.value = ''; } });</script></body>`;

const leggi = (app, k) => app.evaluate(async (_e, k) => (await globalThis.chrome.storage.local.get(k))[k] ?? null, k);

test('in incognito', async ({ app, shell, testServer }) => {
  test.setTimeout(120_000);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ featureFlags: { spellcheck: true, spellcheckContext: false }, correttore: { modelloErrori: false, automatica: true } });
  });
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return w && w._filoTabs ? w._filoTabs.tabs.length : 0;
  }), { timeout: 15_000 }).toBe(1);
  const url = testServer.html(PAGINA).replace('127.0.0.1', 'localhost');
  await app.evaluate(({ BrowserWindow }, u) => { BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs.openTab(u); }, url);
  let page = null;
  await expect.poll(async () => {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } }) || null;
    return page ? page.evaluate(() => document.documentElement.dataset.filoContentReady === '1').catch(() => false) : false;
  }, { timeout: 15_000 }).toBe(true);
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  await page.bringToFront();
  await page.locator('#ta').click();
  for (const m of ['ok ci vediamo', 'si va bene', 'che zanzibarro', 'che zanzibarro', 'che zanzibarro']) {
    await page.keyboard.type(m + ' ');
    await page.waitForTimeout(1500);
    console.log('INCO SEGNI', JSON.stringify(await page.locator('.sn-spell-overlay .sn-errore').allTextContents()));
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('allora perchè ');
  console.log('INCO VAL', JSON.stringify(await page.locator('#ta').inputValue()));
  await page.waitForTimeout(1500);
  console.log('INCO STILI', JSON.stringify(await leggi(app, 'sn_correttore_stili')));
  console.log('INCO IMPARATO', JSON.stringify(await leggi(app, 'sn_correttore_imparato')));
  console.log('INCO DIZ', JSON.stringify(await leggi(app, 'sn_personal_dict')));
});

test('propio tre volte', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ featureFlags: { spellcheck: true, spellcheckContext: false }, correttore: { modelloErrori: false, automatica: true } });
  });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  await page.locator('#ta').click();
  for (let i = 0; i < 4; i++) { await page.keyboard.type('Era propio lui '); await page.keyboard.press('Enter'); }
  for (const m of ['ok ci vediamo', 'si va bene', 'zanzibarro arriva', 'zanzibarro torna', 'zanzibarro parte']) {
    await page.keyboard.type(m + ' ');
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('Era propio lui ');
  await page.waitForTimeout(1200);
  console.log('PROPIO VAL', JSON.stringify(await page.locator('#ta').inputValue()));
  console.log('PROPIO SEGNI', JSON.stringify(await page.locator('.sn-spell-overlay .sn-errore').allTextContents()));
  console.log('PROPIO IMPARATO', JSON.stringify(await leggi(app, 'sn_correttore_imparato')), JSON.stringify(await leggi(app, 'sn_personal_dict')));
});
