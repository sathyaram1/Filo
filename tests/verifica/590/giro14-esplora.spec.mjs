// Verifica #590 giro 14 — esplorazione delle strade verso un sito della lista.
// App lanciata con più nomi mappati al loopback (searx.*, libero.test).

import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, _electron as electron, expect } from '@playwright/test';
import { test as filoTest, argomentiScala } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const test = filoTest.extend({
  app: async ({}, use) => {
    const userData = cartellaTemporanea('filo-test-');
    const app = await electron.launch({
      args: [
        ...argomentiScala,
        '--host-resolver-rules=MAP blocked.test 127.0.0.1, MAP *.blocked.test 127.0.0.1, MAP searx.xyz 127.0.0.1, MAP searx.qualunque.com 127.0.0.1, MAP libero.test 127.0.0.1',
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

async function enableBlock(shell, list = [BLOCKED]) {
  await shell.evaluate((l) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: l } } },
  }), list);
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));
}

const tabUrls = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  return w ? w._filoTabs.tabs.map((t) => t.url) : [];
});
const winCount = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => {
  let u = ''; try { u = w.webContents.getURL(); } catch (_) {}
  return u;
}));

function on(testServer, host, body) {
  return testServer.html(body).replace('127.0.0.1', host);
}

test('punto finale: link, barra della scheda, NAVIGA', async ({ app, shell, openTab, testServer }) => {
  await enableBlock(shell);
  const target = on(testServer, 'blocked.test.', '<h1 id="t">BLOCCATO</h1>');
  const from = testServer.html(`<a id="go" href="${target}">vai</a>`);
  const page = await openTab(from);
  await page.waitForSelector('#go');
  await page.evaluate(() => document.getElementById('go').click());
  await page.waitForTimeout(1500);
  const notif = await shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).count();
  console.log('LINK punto finale: url=', page.url(), 'notifiche=', notif, 'tabs=', await tabUrls(app));
  expect(page.url()).toBe(from);
});

test('finestrella di accesso verso il sito della lista', async ({ app, shell, openTab, testServer }) => {
  await enableBlock(shell);
  const target = on(testServer, BLOCKED, '<h1 id="t">BLOCCATO NELLA FINESTRELLA</h1>').replace(/\/(\d+)$/, '/$1') ;
  // Il testServer serve per id: aggiungiamo un percorso da accesso come query.
  const login = `${target}?response_type=code&client_id=x&redirect_uri=y`;
  const from = testServer.html(`<button id="b" onclick="window.open('${login}','login','width=500,height=400')">accedi</button><script>setTimeout(()=>window.open('${login}','login2','width=500,height=400'),300)</script>`);
  const prima = await winCount(app);
  const page = await openTab(from);
  await page.waitForTimeout(2000);
  const dopoAuto = await winCount(app);
  await page.click('#b');
  await page.waitForTimeout(2000);
  const dopo = await winCount(app);
  const notif = await shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).count();
  console.log('AUTH POPUP prima=', prima, 'dopoAuto=', dopoAuto, 'dopoClic=', dopo, 'notifiche=', notif, 'tabs=', await tabUrls(app));
  expect(dopo.filter((u) => u.includes(BLOCKED))).toEqual([]);
});

test('chip dei popup: «Apri» su un popup verso il sito della lista', async ({ app, shell, openTab, testServer }) => {
  await enableBlock(shell);
  const target = on(testServer, BLOCKED, '<h1 id="t">BLOCCATO DAL POPUP</h1>');
  const from = testServer.html(`<button id="b" onclick="window.open('${target}','p','width=400,height=300')">pop</button>`);
  const page = await openTab(from);
  await page.click('#b');
  const chip = shell.locator('.popup-chip');
  await expect(chip.first()).toBeVisible({ timeout: 6000 });
  console.log('CHIP testo=', await chip.first().innerText());
  await chip.first().locator('button', { hasText: 'Apri' }).click();
  await page.waitForTimeout(2000);
  const notif = await shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).count();
  const urls = await tabUrls(app);
  console.log('CHIP dopo Apri: notifiche=', notif, 'tabs=', urls);
  await shell.screenshot({ path: 'tests/.shots/590-g14-chip.png' });
  expect(urls.filter((u) => u.includes(BLOCKED))).toEqual([]);
});

test('searx: nome comprato vs sottodominio di chiunque', async ({ app, shell, openTab, testServer }) => {
  await enableBlock(shell);
  const target = on(testServer, BLOCKED, '<h1 id="t">ARRIVATO DA SEARX</h1>');
  const res = {};
  for (const host of ['searx.xyz', 'searx.qualunque.com']) {
    const from = on(testServer, host, `<a id="go" href="${target}">vai</a>`);
    const page = await openTab(from);
    await page.waitForSelector('#go');
    await page.evaluate(() => document.getElementById('go').click());
    await page.waitForTimeout(1500);
    res[host] = page.url();
  }
  console.log('SEARX', res);
  expect(res['searx.qualunque.com']).not.toContain(BLOCKED);
  expect(res['searx.xyz']).not.toContain(BLOCKED);
});

test('indietro e ricarica dopo aver messo il sito in lista', async ({ app, shell, openTab, testServer }) => {
  const target = on(testServer, BLOCKED, '<h1 id="t">SITO</h1><script>document.title="SITO "+Date.now()</script>');
  const altro = testServer.html('<h1 id="a">ALTRO</h1>');
  const page = await openTab(target);
  await page.waitForSelector('#t');
  const t1 = await page.title();
  // Ricarica
  await enableBlock(shell);
  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.activeId);
  await shell.evaluate((i) => window.filoShell.tabs.reload(i), id);
  await page.waitForTimeout(1500);
  const t2 = await page.title().catch(() => '');
  const notifReload = await shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).count();
  console.log('RICARICA t1=', t1, 't2=', t2, 'url=', page.url(), 'notifiche=', notifReload);
  // Indietro
  await enableBlock(shell, []);
  await shell.evaluate(([i, u]) => window.filoShell.tabs.navigate(i, u), [id, altro]);
  await page.waitForTimeout(1500);
  await enableBlock(shell);
  await shell.evaluate((i) => window.filoShell.tabs.back(i), id);
  await page.waitForTimeout(1500);
  const urls = await tabUrls(app);
  const notifBack = await shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).count();
  console.log('INDIETRO tabs=', urls, 'notifiche=', notifBack);
});

test('NAVIGA senza schema verso un sito libero', async ({ app, shell, testServer }) => {
  // eseguito direttamente dal main come l'azione del modello
  const target = on(testServer, 'libero.test', '<h1 id="t">LIBERO</h1>').replace(/^http:\/\//, '');
  const out = await app.evaluate(async ({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const id = w._filoTabs.openTab(u, { activate: true });
    await new Promise((r) => setTimeout(r, 2500));
    const t = w._filoTabs.tabs.find((x) => x.id === id);
    return { id, url: t && t.url, wcUrl: t && t.view.webContents.getURL(), title: t && t.view.webContents.getTitle() };
  }, target);
  console.log('NUDO', target, out);
});
