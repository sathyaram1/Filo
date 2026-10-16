// Esplorazione della verifica #843, giro 1: schede doppie, incognito, riquadri, aspetto.
import { test, expect } from '../../fixtures/electron.mjs';

const SITO = 'filo-843.test';
const ALTRO = 'altro-843.test';
test.use({ hostInPiu: [SITO, ALTRO] });

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Pagina 843</title></head>
<body style="padding:40px;font:16px sans-serif"><p id="testo">Un paragrafo qualunque, senza un menu del sito.</p></body></html>`;

const esclusi = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).blocklist);

async function apriSu(openTab, testServer, host, html = PAGINA) {
  const page = await openTab(testServer.html(html).replace('127.0.0.1', host));
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}
const riserva = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible() && x.webContents.getURL().startsWith('data:text/html'));
  return w ? w.webContents.executeJavaScript("[...document.querySelectorAll('.item .lbl')].map((n) => n.textContent)") : [];
});
const scegli = (app, voce) => app.evaluate(({ BrowserWindow }, v) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible() && x.webContents.getURL().startsWith('data:text/html'));
  return w.webContents.executeJavaScript(`[...document.querySelectorAll('button.item')].find((b) => b.textContent.trim() === ${JSON.stringify(v)}).click()`);
}, voce);

test('due schede sullo stesso sito: spento da una, l\'altra segue senza ricaricare', async ({ app, openTab, testServer }) => {
  const a = await apriSu(openTab, testServer, SITO);
  const b = await apriSu(openTab, testServer, SITO);
  await a.bringToFront();
  await a.locator('#testo').click({ button: 'right' });
  await a.locator('.sn-menu .sn-menu-item', { hasText: 'Spegni Filo su questo sito' }).click();
  await expect.poll(() => esclusi(app)).toEqual([SITO]);
  await b.bringToFront();
  await b.waitForTimeout(400);
  await b.locator('#testo').click({ button: 'right' });
  await expect.poll(() => riserva(app), { timeout: 5000 }).toContain('Riaccendi Filo su questo sito');
  await expect(b.locator('.sn-menu')).toHaveCount(0);
});

test('incognito: spento lì resta lì, e la scheda incognito segue', async ({ app, shell, testServer }) => {
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs))).toBe(true);
  const url = testServer.html(PAGINA).replace('127.0.0.1', SITO);
  await app.evaluate(({ BrowserWindow }, u) => { BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab(u); }, url);
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url() === url); return !!page; }, { timeout: 10000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#testo').click({ button: 'right' });
  await page.locator('.sn-menu .sn-menu-item', { hasText: 'Spegni Filo su questo sito' }).click();
  await page.waitForTimeout(800);
  const normali = await esclusi(app);
  const incog = await app.evaluate(() => require('./src/main/shim/storage').runIncognito(async () => (await globalThis.SN_STORAGE.getSettings()).blocklist)).catch((e) => `err ${e.message}`);
  console.log('normali', JSON.stringify(normali), 'incognito', JSON.stringify(incog));
  await page.locator('#testo').click({ button: 'right' });
  await page.waitForTimeout(800);
  console.log('riserva incognito', JSON.stringify(await riserva(app)), 'menu filo', await page.locator('.sn-menu').count());
  expect(normali).toEqual([]);
});

test('riquadro di un altro sito dentro un sito spento: il tasto destro lì offre di riaccendere', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html(PAGINA).replace('127.0.0.1', ALTRO);
  await app.evaluate(async (_e, s) => { await globalThis.SN_STORAGE.updateSettings({ blocklist: [s] }); }, SITO);
  const page = await apriSu(openTab, testServer, SITO, `<!doctype html><html><body style="margin:0"><p id="testo">Fuori</p><iframe id="f" src="${dentro}" style="width:600px;height:300px;border:0"></iframe></body></html>`);
  const box = await page.locator('#f').boundingBox();
  await page.waitForTimeout(800);
  await page.mouse.click(box.x + 80, box.y + 50, { button: 'right' });
  await expect.poll(() => riserva(app), { timeout: 6000 }).toContain('Riaccendi Filo su questo sito');
  await scegli(app, 'Riaccendi Filo su questo sito');
  await expect.poll(() => esclusi(app), { timeout: 5000 }).toEqual([]);
});

test('aspetto: la voce nel menu di Filo e il menu di riserva, chiaro e scuro', async ({ app, openTab, testServer }) => {
  for (const theme of ['light', 'dark']) {
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t, blocklist: [] }); }, theme);
    const page = await apriSu(openTab, testServer, SITO);
    await page.locator('#testo').click({ button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/v843-menu-${theme}.png` });
    await page.locator('.sn-menu .sn-menu-item', { hasText: 'Spegni Filo su questo sito' }).click();
    await page.waitForTimeout(500);
    await page.locator('#testo').click({ button: 'right' });
    await expect.poll(() => riserva(app), { timeout: 5000 }).toContain('Riaccendi Filo su questo sito');
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible() && x.webContents.getURL().startsWith('data:text/html'));
      return (await w.webContents.capturePage()).toPNG().toString('base64');
    });
    require('node:fs').writeFileSync(`tests/.shots/v843-riserva-${theme}.png`, Buffer.from(png, 'base64'));
    await page.keyboard.press('Escape');
    const altro = await openTab('filo://options/altro.html');
    await altro.waitForTimeout(600);
    await altro.screenshot({ path: `tests/.shots/v843-altro-${theme}.png` });
  }
});

test('Shift+tasto destro su sito acceso e sito con un suo menu spento', async ({ app, openTab, testServer }) => {
  const page = await apriSu(openTab, testServer, SITO);
  await page.locator('#testo').click({ button: 'right', modifiers: ['Shift'] });
  await page.waitForTimeout(800);
  console.log('shift acceso', JSON.stringify(await riserva(app)), await page.locator('.sn-menu').count());
  await page.keyboard.press('Escape');
  await app.evaluate(async (_e, s) => { await globalThis.SN_STORAGE.updateSettings({ blocklist: [s] }); }, ALTRO);
  const proprio = await apriSu(openTab, testServer, ALTRO, `<!doctype html><html><body><p id="testo">menu suo</p><div id="m" hidden>MENU DEL SITO</div>
<script>document.addEventListener('contextmenu', (e) => { e.preventDefault(); document.getElementById('m').hidden = false; });</script></body></html>`);
  await proprio.waitForTimeout(500);
  await proprio.locator('#testo').click({ button: 'right' });
  await proprio.waitForTimeout(800);
  console.log('sito col menu spento', JSON.stringify(await riserva(app)), await proprio.locator('.sn-menu').count(), await proprio.locator('#m').isVisible());
});

test('pagina Altro: incolli strani', async ({ app, openTab }) => {
  const altro = await openTab('filo://options/altro.html');
  const casella = altro.locator('#blocklist');
  await expect(casella).toHaveValue('', { timeout: 8000 });
  for (const testo of ['  WWW.Example.COM  ', 'docs.google.com, figma.com', 'http://localhost:3000/x', '<img src=x onerror=alert(1)>', '🍕.it', 'https://www.Docs.Google.com/document/d/x?usp=sharing#heading=h.1']) {
    await casella.fill('');
    await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);
    await casella.click();
    await altro.keyboard.press('Control+V');
    await altro.locator('#h-blocklist').click();
    await altro.waitForTimeout(500);
    console.log(JSON.stringify(testo), '→ casella', JSON.stringify(await casella.inputValue()), 'salvati', JSON.stringify(await esclusi(app)), 'errore', JSON.stringify(await altro.locator('#blocklistError').textContent()));
  }
});
