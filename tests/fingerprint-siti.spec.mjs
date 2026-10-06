// #796 — Lo stesso script di tracciamento su due siti diversi legge due impronte diverse anche sotto un suffisso
// nazionale a due livelli o su due IP; le pagine dello stesso sito ne leggono una sola. Il sito è quello dei cookie, e
// in Privacy il vaso persistente di un sito fidato è del sito anche quando la voce è un suffisso o un sottodominio.
// I nomi arrivano al server locale con host-resolver-rules: la rete vera non serve.

import { test as base, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOMI = ['shop.com.tw', 'www.shop.com.tw', 'altro.com.tw', 'negozio.co.id', 'toko.co.id', 'tienda.com.co', 'otra.com.co', '192.168.1.10', '10.0.1.10'];
const NOMI_FIDATI = ['www.bbc.co.uk', 'www.argos.co.uk', 'webmail.libero.it', 'www.libero.it'];

const test = base.extend({
  app: async ({}, use) => {
    const userData = cartellaTemporanea('filo-fp-siti-');
    const app = await electron.launch({
      args: [...argomentiScala, `--host-resolver-rules=${[...NOMI, ...NOMI_FIDATI].map((n) => `MAP ${n} 127.0.0.1`).join(', ')}`, '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

// Quello che fa uno script di fingerprinting: disegna una scena fissa e ne legge i pixel.
const IMPRONTA = () => {
  const c = document.createElement('canvas');
  c.width = 80; c.height = 40;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1e90ff'; ctx.fillRect(0, 0, 80, 40);
  ctx.fillStyle = '#000'; ctx.font = '16px sans-serif'; ctx.fillText('filo', 4, 24);
  const url = c.toDataURL();
  if (!url.startsWith('data:image/png')) return url;
  // Su http non c'è crypto.subtle: basta un FNV-1a a 32 bit, preso due volte con semi diversi.
  const fnv = (s, h) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };
  return [fnv(url, 2166136261), fnv(url, 33554467)].map((h) => h.toString(16).padStart(8, '0')).join('');
};

test('due siti diversi leggono impronte diverse, due pagine dello stesso sito la stessa', async ({ openTab, testServer }) => {
  test.setTimeout(90_000);
  const porta = new URL(testServer.origin).port;
  const impronte = {};
  for (const nome of NOMI) {
    const id = new URL(testServer.html(`<title>FP ${nome}</title><p>${nome}</p>`)).pathname;
    const page = await openTab(`http://${nome}:${porta}${id}`);
    await page.waitForFunction(() => window.__filoFpGuard === true, null, { timeout: 8_000 });
    impronte[nome] = await page.evaluate(IMPRONTA);
    expect(impronte[nome]).toMatch(/^[0-9a-f]{16}$/);
  }
  expect(impronte['www.shop.com.tw']).toBe(impronte['shop.com.tw']);
  expect(impronte['altro.com.tw']).not.toBe(impronte['shop.com.tw']);
  expect(impronte['toko.co.id']).not.toBe(impronte['negozio.co.id']);
  expect(impronte['otra.com.co']).not.toBe(impronte['tienda.com.co']);
  expect(impronte['10.0.1.10']).not.toBe(impronte['192.168.1.10']);
});

// ─── Siti fidati in Privacy: il vaso persistente è del sito ───────────────────

const CONNESSO = 'C=sess=abc';
let server;
let port;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const head = { 'Content-Type': 'text/html; charset=utf-8' };
    if (u.pathname === '/accedi') head['Set-Cookie'] = 'sess=abc; Max-Age=86400; Path=/';
    res.writeHead(200, head);
    res.end(`<!doctype html><meta charset="utf-8"><script>document.title = 'C=' + ${JSON.stringify(req.headers.cookie || '-')};</script>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((r) => server.close(r));
});


async function privacy(app, shell, trustedSites) {
  await shell.evaluate((t) => window.filoShell.message({
    type: 'update_settings', settings: { security: { cookies: { mode: 'privacy', trustedSites: t } } },
  }), trustedSites);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .some((w) => w._filoTabs && w._filoTabs.cookieMode === 'privacy')), { timeout: 5000 }).toBe(true);
}

async function apri(app, shell, nome, percorso) {
  const url = `http://${nome}:${port}${percorso}`;
  const { id } = await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let s = null;
  await expect.poll(async () => {
    s = await app.evaluate(({ BrowserWindow }, tabId) => {
      for (const w of BrowserWindow.getAllWindows()) {
        const t = w._filoTabs && w._filoTabs.tabs.find((x) => x.id === tabId);
        if (t) return { url: t.view.webContents.getURL(), titolo: t.view.webContents.getTitle(), carica: t.view.webContents.isLoading(), partizione: t.partition || null };
      }
      return null;
    }, id);
    return !!s && s.url === url && !s.carica && s.titolo.startsWith('C=');
  }, { timeout: 10_000 }).toBe(true);
  await shell.evaluate((t) => window.filoShell.tabs.close(t), id);
  return s;
}

test('una voce fidata salvata come suffisso tiene connessi i siti sotto di lei, ognuno nel suo vaso', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await privacy(app, shell, ['co.uk']);
  const bbc = await apri(app, shell, 'www.bbc.co.uk', '/accedi');
  const argos = await apri(app, shell, 'www.argos.co.uk', '/');
  expect(bbc.partizione).toMatch(/^persist:/);
  expect(argos.partizione).toMatch(/^persist:/);
  expect(argos.partizione, 'due siti, due vasi: argos non vede il cookie di bbc').not.toBe(bbc.partizione);
  expect(argos.titolo).toBe('C=-');
  // Un giro sull'elenco dei fidati spazza i vasi orfani: quello di un sito coperto dalla voce resta.
  await privacy(app, shell, ['co.uk', 'esempio.it']);
  await new Promise((r) => setTimeout(r, 1500));
  expect((await apri(app, shell, 'www.bbc.co.uk', '/torno')).titolo).toBe(CONNESSO);
});

test('un sito fidato scritto col suo sottodominio resta connesso su tutto il sito', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await privacy(app, shell, ['webmail.libero.it']);
  const a = await apri(app, shell, 'webmail.libero.it', '/accedi');
  expect(a.partizione).toMatch(/^persist:/);
  await privacy(app, shell, ['webmail.libero.it', 'esempio.it']);
  await new Promise((r) => setTimeout(r, 1500));
  expect((await apri(app, shell, 'webmail.libero.it', '/torno')).titolo).toBe(CONNESSO);
  expect((await apri(app, shell, 'www.libero.it', '/')).partizione).toBe(a.partizione);
});
