// #771 giro 4: riquadro in Sicurezza solo col fornitore; consiglio del -130 sul paese solo nella scheda instradata.
// Proxy di sistema simulato sulla sessione normale; fornitore finto su una porta chiusa.

import { test, expect } from '../../fixtures/electron.mjs';

async function errorPage(app, host) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const w = app.windows().find((x) => x.url().startsWith('filo://error') && x.url().includes(encodeURIComponent(host)));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('pagina d’errore non trovata');
}

test('Sicurezza: senza fornitore niente riquadro, col fornitore c’è col nome dell’host', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://security/');
  await page.waitForSelector('#sec-p2p-box-title');
  await page.waitForTimeout(800);
  await expect(page.locator('#sec-proxy-box')).toBeHidden();
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: 'socks5://user:pw@gate.esempio.net:1080' } });
  });
  await page.reload();
  await page.waitForSelector('#sec-p2p-box-title');
  await expect(page.locator('#sec-proxy-box')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#sec-proxy-box-provider')).toContainText('gate.esempio.net');
  expect(await page.locator('#sec-proxy-box').innerText()).not.toContain('pw');
});

test('proxy di sistema irraggiungibile in una scheda normale: il consiglio non parla di altri paesi', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async ({ session }) => {
    await session.defaultSession.setProxy({ proxyRules: 'http://127.0.0.1:9', proxyBypassRules: '<-loopback>' });
  });
  const url = testServer.html('<title>X</title><p>x</p>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const err = await errorPage(app, new URL(url).host);
  const body = await err.locator('body').innerText();
  expect(body).toContain('proxy');
  expect(body).not.toMatch(/paese/i);
});

test('scheda instradata col fornitore irraggiungibile: il consiglio nomina l’altro paese', async ({ app, shell, testServer, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const url = testServer.html('<title>Y</title><p>y</p>');
  await openTab(url);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: 'http://127.0.0.1:9', bypass: '<-loopback>' } });
  });
  const r = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => /^http:/.test(x.url || ''));
    return w._filoTabs.setTabProxy(t.id, 'fr');
  });
  expect(r.ok).toBe(true);
  const err = await errorPage(app, new URL(url).host);
  await expect(err.locator('body')).toContainText('altro paese', { timeout: 5_000 });
});
