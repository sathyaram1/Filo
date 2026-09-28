// Verifica #590 giro 14 — esplorazione 2.

import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { _electron as electron, expect } from '@playwright/test';
import { test as filoTest, argomentiScala } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const test = filoTest.extend({
  app: async ({}, use) => {
    const userData = cartellaTemporanea('filo-test-');
    const app = await electron.launch({
      args: [
        ...argomentiScala,
        '--host-resolver-rules=MAP blocked.test 127.0.0.1, MAP searx.xyz 127.0.0.1, MAP tracker.test 127.0.0.1, MAP articolo.test 127.0.0.1, MAP libero.test 127.0.0.1, MAP sites.google.com 127.0.0.1, MAP baijiahao.baidu.com 127.0.0.1',
        '.',
      ],
      cwd: process.cwd(),
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    await use(app);
    try { await app.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

const BLOCKED = 'blocked.test';

async function settings(shell, siteBlock) {
  await shell.evaluate((sb) => window.filoShell.message({ type: 'update_settings', settings: { security: { siteBlock: sb } } }), siteBlock);
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));
}

const tabUrls = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  return w ? w._filoTabs.tabs.map((t) => ({ url: t.url, wc: t.view.webContents.getURL(), title: t.view.webContents.getTitle() })) : [];
});
const on = (ts, host, body) => ts.html(body).replace('127.0.0.1', host);
async function redirector(to) {
  const server = createServer((_req, res) => { res.writeHead(302, { Location: to }); res.end(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}
async function countToasts(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    globalThis.__toasts = [];
    const orig = w.webContents.send.bind(w.webContents);
    w.webContents.send = (ch, ...a) => { if (ch === 'shell:toast') globalThis.__toasts.push(a[0] && a[0].text); return orig(ch, ...a); };
  });
}

test('contatore di clic in un rimbalzo, impostazioni di fabbrica', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(() => { globalThis.__filoAdblock.setDomainsForTest(['tracker.test']); });
  const articolo = on(testServer, 'articolo.test', '<h1 id="a">ARTICOLO</h1>');
  const trk = await redirector(articolo);
  const trackerUrl = `http://tracker.test:${trk.port}/c?u=1`;
  const primo = await redirector(trackerUrl);
  try {
    await countToasts(app);
    const from = testServer.html(`<a id="go" href="http://127.0.0.1:${primo.port}/r">articolo</a> <a id="dir" href="${trackerUrl}">diretto</a>`);
    const page = await openTab(from);
    await page.waitForSelector('#go');
    await page.evaluate(() => document.getElementById('go').click());
    await page.waitForTimeout(2000);
    console.log('TRACKER rimbalzo: tab=', page.url(), 'toasts=', await app.evaluate(() => globalThis.__toasts), 'tabs=', await tabUrls(app));
    await page.goto(from).catch(() => {});
    await page.waitForTimeout(800);
    await page.evaluate(() => document.getElementById('dir').click());
    await page.waitForTimeout(2000);
    console.log('TRACKER diretto: tab=', page.url(), 'toasts=', await app.evaluate(() => globalThis.__toasts));
    const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first();
    if (await card.count()) {
      await shell.screenshot({ path: 'tests/.shots/590-g14-tracker.png' });
      await card.locator('.shell-notif-action', { hasText: 'Apri comunque' }).click();
      await page.waitForTimeout(2500);
      console.log('TRACKER apri comunque: tabs=', await tabUrls(app));
    }
  } finally { await trk.close(); await primo.close(); }
});

test('risultato di ricerca aperto in scheda nuova che rimbalza', async ({ app, shell, openTab, testServer }) => {
  await settings(shell, { enabled: true, useAdblockLists: false, blacklist: [BLOCKED] });
  const target = on(testServer, BLOCKED, '<h1 id="t">DAL RISULTATO</h1>');
  const r = await redirector(target);
  try {
    const results = on(testServer, 'searx.xyz', `<a id="same" href="http://127.0.0.1:${r.port}/r">stesso</a> <a id="blank" target="_blank" href="http://127.0.0.1:${r.port}/r">nuova</a>`);
    const page = await openTab(results);
    await page.waitForSelector('#blank');
    await page.evaluate(() => document.getElementById('blank').click());
    await page.waitForTimeout(2500);
    console.log('RISULTATO scheda nuova: tabs=', await tabUrls(app));
    await page.evaluate(() => document.getElementById('same').click());
    await page.waitForTimeout(2500);
    console.log('RISULTATO stessa scheda: url=', page.url());
  } finally { await r.close(); }
});

test('pagine di chiunque sui nomi dei motori', async ({ app, shell, openTab, testServer }) => {
  await settings(shell, { enabled: true, useAdblockLists: false, blacklist: [BLOCKED] });
  const target = on(testServer, BLOCKED, '<h1 id="t">ARRIVATO</h1>');
  const res = {};
  for (const host of ['sites.google.com', 'baijiahao.baidu.com']) {
    const from = on(testServer, host, `<a id="go" href="${target}">vai</a><script>setTimeout(()=>{location.href=${JSON.stringify(target)}},1500)</script>`);
    try {
      const page = await openTab(from);
      await page.waitForTimeout(3500);
      res[host] = page.url();
    } catch (e) { res[host] = 'ERR ' + e.message; }
  }
  console.log('MOTORI', res, await tabUrls(app));
});

test('pagina che insiste: quante notifiche', async ({ app, shell, openTab, testServer }) => {
  await settings(shell, { enabled: true, useAdblockLists: false, blacklist: [BLOCKED] });
  await countToasts(app);
  const target = on(testServer, BLOCKED, '<h1>X</h1>');
  const from = testServer.html(`<h1>insiste</h1><script>setInterval(()=>{location.href=${JSON.stringify(target)}},150)</script>`);
  const page = await openTab(from);
  await page.waitForTimeout(5000);
  const n = await app.evaluate(() => globalThis.__toasts.length);
  const vis = await shell.locator('.shell-notif').count();
  await shell.screenshot({ path: 'tests/.shots/590-g14-insiste.png' });
  console.log('INSISTE toasts in 5s=', n, 'visibili=', vis, 'url=', page.url());
});

test('Apri comunque premuto tre volte', async ({ app, shell, openTab, testServer }) => {
  await settings(shell, { enabled: true, useAdblockLists: false, blacklist: [BLOCKED] });
  const target = on(testServer, BLOCKED, '<h1>X</h1>');
  const from = testServer.html(`<a id="go" href="${target}">vai</a>`);
  const page = await openTab(from);
  await page.waitForSelector('#go');
  await page.evaluate(() => document.getElementById('go').click());
  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first();
  await expect(card).toBeVisible({ timeout: 6000 });
  const btn = card.locator('.shell-notif-action', { hasText: 'Apri comunque' });
  await btn.click();
  await btn.click({ timeout: 1000 }).catch((e) => console.log('secondo clic non possibile', e.message.slice(0, 80)));
  await btn.click({ timeout: 1000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log('TRE CLIC tabs=', (await tabUrls(app)).map((t) => t.url));
});

test('indirizzo senza schema dal modello verso un sito libero', async ({ app, shell }) => {
  await shell.waitForTimeout(1500);
  const out = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const id = w._filoTabs.openTab('libero.test/pagina', { activate: true });
    await new Promise((r) => setTimeout(r, 3000));
    const t = w._filoTabs.tabs.find((x) => x.id === id);
    return { id, url: t && t.url, wcUrl: t && t.view.webContents.getURL(), title: t && t.view.webContents.getTitle() };
  });
  console.log('NUDO', out);
});

test('Preferenze: riga scritta e poi si cambia scheda', async ({ app, shell, openTab, testServer }) => {
  const page = await openTab('filo://security/security.html');
  await page.waitForSelector('#sec-siteblock-blacklist', { timeout: 8000 });
  await page.locator('#sec-siteblock-blacklist').click();
  await page.keyboard.type('blocked.test');
  // l'utente passa a un'altra scheda
  const altro = testServer.html('<h1>altro</h1>');
  await page.waitForTimeout(300);
  const tabsInBar = shell.locator('.tab');
  console.log('schede nella barra', await tabsInBar.count());
  await tabsInBar.first().click();
  await page.waitForTimeout(1500);
  const saved = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security?.siteBlock?.blacklist || []);
  console.log('PREFERENZE salvato dopo cambio scheda =', saved);
});
