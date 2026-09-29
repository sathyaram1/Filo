// Rete finta con nomi veri per gli spec della lista dei siti bloccati (#590): un server
// locale risponde per nome e percorso agli host mappati qui (www.bing.com, blocked.test…).
// Non parla con la rete vera; ogni host nuovo va aggiunto a HOSTS.

import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { test as filoTest, expect, chiudiApp } from '../fixtures/electron.mjs';
import { cartellaTemporanea } from './percorsi.mjs';
import { argomentiScala } from './scala.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..', '..');

export const HOSTS = [
  'blocked.test', 'www.blocked.test', 'sito.test', 'accorcia.test', 'tracker.test', 'articolo.test',
  'libero.test', 'www.bing.com',
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
    const app = await avviaFilo(rete, userData);
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

// Filo sulla rete finta con una cartella dati scelta da chi chiama: due avvii sulla stessa
// cartella sono una riapertura di Filo.
export function avviaFilo(rete, userData) {
  const rules = HOSTS.map((h) => `MAP ${h} 127.0.0.1:${rete.port}`).join(', ');
  return electron.launch({
    args: [...argomentiScala, `--host-resolver-rules=${rules}`, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
  });
}

export { chiudiApp, cartellaTemporanea };

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

// La scheda (indirizzo per l'utente e indirizzo caricato) che sta sul sito `host`, anche dalla pagina «Sito bloccato».
export const schedaSu = (app, host) => app.evaluate(({ BrowserWindow }, h) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const t = w && w._filoTabs.tabs.find((x) => String(x.url || '').includes(h));
  return t ? { id: t.id, url: t.url, caricata: t.view.webContents.getURL() } : null;
}, host);
