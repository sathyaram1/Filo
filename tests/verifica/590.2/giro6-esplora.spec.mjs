// Esplorazione giro 6 (da togliere o rinominare).
import { test, expect } from '../../fixtures/electron.mjs';

const impostazioni = async (shell) => (await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' }))).settings;
const snap = (shell) => shell.evaluate(() => window.filoShell.tabs.snapshot());

async function apriSicurezza(shell, openTab) {
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: [] } } },
  }));
  const page = await openTab('filo://security/security.html');
  await page.waitForSelector('#sec-siteblock-blacklist', { timeout: 8000 });
  await page.waitForTimeout(500);
  return page;
}
const tasti = (app, lista) => app.evaluate(({ BrowserWindow }, t) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const tab = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  for (const e of t) tab.view.webContents.sendInputEvent(e);
}, lista);
async function scriviVero(app, testo) {
  for (const c of testo) {
    await tasti(app, [{ type: 'keyDown', keyCode: c }, { type: 'char', keyCode: c }, { type: 'keyUp', keyCode: c }]);
    await new Promise((r) => setTimeout(r, 20));
  }
}
// Clic vero sulla striscia delle schede (shell = webContents della finestra).
const clicShell = (app, x, y, button = 'left') => app.evaluate(({ BrowserWindow }, p) => {
  const w = BrowserWindow.getAllWindows().find((z) => z._filoTabs);
  const wc = w.webContents;
  wc.focus();
  wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: p.button, clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: p.button, clickCount: 1 });
}, { x, y, button });
const centro = (shell, sel, i) => shell.evaluate(([s, k]) => {
  const el = document.querySelectorAll(s)[k];
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}, [sel, i]);

test('E1 clic su un\'altra scheda 80 ms dopo aver scritto', async ({ app, shell, openTab }) => {
  const page = await apriSicurezza(shell, openTab);
  await page.locator('#sec-siteblock-blacklist').click();
  await scriviVero(app, 'blocked.test');
  await new Promise((r) => setTimeout(r, 80));
  const p = await centro(shell, '.tab:not(.active)', 0);
  await clicShell(app, p.x, p.y);
  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 }).toEqual(['blocked.test']);
});

test('E2 clic sulla X della scheda Sicurezza 80 ms dopo aver scritto', async ({ app, shell, openTab }) => {
  const page = await apriSicurezza(shell, openTab);
  await page.locator('#sec-siteblock-blacklist').click();
  await scriviVero(app, 'blocked.test');
  await new Promise((r) => setTimeout(r, 80));
  const p = await centro(shell, '.tab.active .close', 0);
  await clicShell(app, p.x, p.y);
  await expect.poll(async () => (await snap(shell)).tabs.some((t) => t.url.startsWith('filo://security')), { timeout: 4000 }).toBe(false);
  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 }).toEqual(['blocked.test']);
});

test('E3 clic centrale sulla scheda Sicurezza 80 ms dopo aver scritto', async ({ app, shell, openTab }) => {
  const page = await apriSicurezza(shell, openTab);
  await page.locator('#sec-siteblock-blacklist').click();
  await scriviVero(app, 'blocked.test');
  await new Promise((r) => setTimeout(r, 80));
  const p = await centro(shell, '.tab.active', 0);
  await clicShell(app, p.x, p.y, 'middle');
  await expect.poll(async () => (await snap(shell)).tabs.some((t) => t.url.startsWith('filo://security')), { timeout: 4000 }).toBe(false);
  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 }).toEqual(['blocked.test']);
});

test('E4 Ctrl+Tab vero subito dopo aver scritto', async ({ app, shell, openTab }) => {
  const page = await apriSicurezza(shell, openTab);
  await page.locator('#sec-siteblock-blacklist').click();
  await scriviVero(app, 'blocked.test');
  await tasti(app, [{ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] }, { type: 'keyDown', keyCode: 'Tab', modifiers: ['control'] }]);
  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 }).toEqual(['blocked.test']);
});

test('E5 due pagine Sicurezza: scritto in A, passati a B, B mostra la riga e scrivendo in B non la perde', async ({ app, shell, openTab }) => {
  const a = await apriSicurezza(shell, openTab);
  const b = await openTab('filo://security/security.html');
  await b.waitForSelector('#sec-siteblock-blacklist');
  await b.waitForTimeout(500);
  const s = await snap(shell);
  const ids = s.tabs.filter((t) => t.url.startsWith('filo://security')).map((t) => t.id);
  console.log('schede sicurezza', ids.length);
  await shell.evaluate((i) => window.filoShell.tabs.activate(i), ids[0]);
  await a.waitForTimeout(300);
  await a.locator('#sec-siteblock-blacklist').click();
  await a.keyboard.type('blocked.test');
  await a.waitForTimeout(800);
  await shell.evaluate((i) => window.filoShell.tabs.activate(i), ids[1]);
  await b.waitForTimeout(800);
  console.log('B mostra:', JSON.stringify(await b.locator('#sec-siteblock-blacklist').inputValue()));
  await b.locator('#sec-siteblock-blacklist').click();
  await b.keyboard.press('Control+End');
  await b.keyboard.type('altro.test');
  await b.waitForTimeout(800);
  console.log('salvata:', JSON.stringify((await impostazioni(shell)).security.siteBlock.blacklist));
  expect((await impostazioni(shell)).security.siteBlock.blacklist).toContain('blocked.test');
});

test('E6 righe con HTML ed emoji: niente markup, tornano uguali', async ({ shell, openTab }) => {
  const page = await apriSicurezza(shell, openTab);
  await page.locator('#sec-siteblock-blacklist').click();
  await page.keyboard.type('<img src=x onerror="document.title=\'PWN\'">\n🍕pizza\nfacebook.com');
  await page.waitForTimeout(800);
  await page.locator('h1, body').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(500);
  console.log('avviso:', await page.locator('#sec-siteblock-blacklist-error').innerText());
  expect(await page.title()).not.toBe('PWN');
  await page.reload();
  await page.waitForSelector('#sec-siteblock-blacklist');
  await page.waitForTimeout(600);
  console.log('dopo:', JSON.stringify(await page.locator('#sec-siteblock-blacklist').inputValue()));
  await page.screenshot({ path: 'tests/.shots/590-giro6-html.png' });
});

test('E7 una lista hosts da 60.000 righe incollata: la pagina resta usabile', async ({ shell, openTab }) => {
  test.setTimeout(120_000);
  const page = await apriSicurezza(shell, openTab);
  const testo = Array.from({ length: 30000 }, (_, i) => `sito${i}.com\n# commento ${i}`).join('\n');
  await page.locator('#sec-siteblock-blacklist').click();
  const t0 = Date.now();
  await page.evaluate((t) => { navigator.clipboard; const el = document.getElementById('sec-siteblock-blacklist'); el.focus(); document.execCommand('insertText', false, t); }, testo);
  await page.waitForTimeout(1500);
  console.log('incolla+salva ms', Date.now() - t0);
  const t1 = Date.now();
  await page.reload();
  await page.waitForSelector('#sec-siteblock-blacklist');
  await expect.poll(async () => (await page.locator('#sec-siteblock-blacklist').inputValue()).length, { timeout: 60000 }).toBeGreaterThan(1000);
  console.log('riapertura ms', Date.now() - t1);
  const s = await impostazioni(shell);
  console.log('validi', s.security.siteBlock.blacklist.length, 'scartate', (s.security.siteBlock.righeScartate || []).length);
});
