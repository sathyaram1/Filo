// Verifica #590.2 giro 5, rilievo 1: mentre si corregge a mano una riga della lista dei bloccati,
// la scheda già ferma su quel sito non lo ricarica per lo stato a metà della correzione.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const aggiorna = (shell, s) => shell.evaluate((x) => window.filoShell.message({ type: 'update_settings', settings: x }), s);
const urlVere = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  return w._filoTabs.tabs.map((t) => t.view.webContents.getURL());
});

test('tolta e riscritta l’ultima lettera di una riga, la scheda bloccata non apre il sito nel frattempo', async ({ app, shell, openTab }) => {
  const visite = [];
  const srv = createServer((req, res) => {
    if (req.url === '/x') visite.push(Date.now());
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><h1>SITO</h1>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const sito = `http://blocked.test:${srv.address().port}/x`;
  try {
    await aggiorna(shell, { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: [], righeScartate: [] } } });
    await shell.evaluate((u) => window.filoShell.tabs.open(u), sito);
    await expect.poll(() => visite.length, { timeout: 8000 }).toBeGreaterThan(0);
    await aggiorna(shell, { security: { siteBlock: { blacklist: ['blocked.test'] } } });
    await expect.poll(async () => (await urlVere(app)).some((u) => u.startsWith('filo://error/') && u.includes('blocked')), { timeout: 5000 }).toBe(true);

    const page = await openTab('filo://security/security.html');
    await page.waitForSelector('#sec-siteblock-blacklist');
    await page.waitForTimeout(500);
    const prima = visite.length;
    await page.locator('#sec-siteblock-blacklist').click();
    await page.keyboard.press('Control+End');
    await page.waitForTimeout(600);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(1200);
    await page.keyboard.type('t');
    await page.waitForTimeout(1200);

    expect(await page.locator('#sec-siteblock-blacklist').inputValue()).toBe('blocked.test');
    expect(visite.length - prima, 'la scheda bloccata ha ricaricato il sito durante la correzione').toBe(0);
    expect((await urlVere(app)).some((u) => u.startsWith('filo://error/') && u.includes('blocked'))).toBe(true);
  } finally {
    srv.close();
  }
});
