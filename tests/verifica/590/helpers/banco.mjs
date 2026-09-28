// Banco del giro 14 di verifica #590: una rete finta con nomi veri.
// Un server locale risponde per nome e percorso a tutti gli host mappati qui
// sotto, così le pagine stanno su «sites.google.com», «www.bing.com», ecc.

import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { test as filoTest, expect, chiudiApp } from '../../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../../helpers/percorsi.mjs';
import { argomentiScala } from '../../../helpers/scala.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..', '..', '..', '..');

export const HOSTS = [
  'blocked.test', 'www.blocked.test', 'sito.test', 'accorcia.test', 'tracker.test', 'articolo.test',
  'libero.test', 'searx.xyz', 'sites.google.com', 'baijiahao.baidu.com', 'www.bing.com',
];

export const test = filoTest.extend({
  rete: async ({}, use) => {
    const pagine = new Map();
    const server = createServer((req, res) => {
      const host = String(req.headers.host || '').split(':')[0];
      const path = req.url.split('?')[0];
      const r = pagine.get(`${host}${path}`);
      if (!r) { res.writeHead(404); res.end('no'); return; }
      if (r.to) { res.writeHead(302, { Location: r.to }); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(r.html);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    await use({
      port,
      pagina(host, path, html) { pagine.set(`${host}${path}`, { html: `<!doctype html><meta charset="utf-8">${html}` }); return `http://${host}${path}`; },
      rimbalzo(host, path, to) { pagine.set(`${host}${path}`, { to }); return `http://${host}${path}`; },
    });
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  },
  app: async ({ rete }, use) => {
    const userData = cartellaTemporanea('filo-test-');
    const rules = HOSTS.map((h) => `MAP ${h} 127.0.0.1:${rete.port}`).join(', ');
    const app = await electron.launch({
      args: [...argomentiScala, `--host-resolver-rules=${rules}`, '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

export { expect };

export async function lista(shell, blacklist, { useAdblockLists = false } = {}) {
  await shell.evaluate(([l, ual]) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: ual, blacklist: l } } },
  }), [blacklist, useAdblockLists]);
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));
}

// Gli indirizzi davvero caricati dalle schede (non quelli chiesti).
export const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  return w ? w._filoTabs.tabs.map((t) => t.view.webContents.getURL()) : [];
});

// Ogni finestra aperta, schede comprese, con l'indirizzo che mostra.
export const finestre = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => {
  try { return w.webContents.getURL(); } catch (_) { return ''; }
}));

export const idAttiva = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.activeId);

export async function apri(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const host = new URL(url).hostname;
  await expect.poll(async () => (await schede(app)).some((u) => { try { return new URL(u).hostname === host; } catch (_) { return false; } }), { timeout: 8000 }).toBe(true);
}

// Conta le notifiche «Sito bloccato» mandate alla shell, anche quelle che la pila butta fuori.
export async function contaAvvisi(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    globalThis.__avvisi590 = [];
    const orig = w.webContents.send.bind(w.webContents);
    w.webContents.send = (ch, ...a) => {
      if (ch === 'shell:toast' && a[0] && /Sito bloccato/.test(a[0].text || '')) globalThis.__avvisi590.push(a[0].text);
      return orig(ch, ...a);
    };
  });
  return () => app.evaluate(() => globalThis.__avvisi590.slice());
}
