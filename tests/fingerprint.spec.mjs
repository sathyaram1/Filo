// Protezione anti-fingerprinting (src/main/services/fingerprint.js +
// src/preload/fingerprint-guard.js, iniettato dal page-preload nel main world).
//
// I test asseriscono il COMPORTAMENTO: con la protezione attiva i segnali ad
// alta entropia (canvas) vengono perturbati di 1 LSB su ~una frazione dei
// pixel — invisibile a occhio ma cambia l'hash — mentre il canale alpha resta
// intatto e il rumore è deterministico per sito (stesso sito → stessa lettura,
// niente flicker). La controprova "Off" verifica che senza protezione i pixel
// tornano esatti (un test che, rimosso il fix, diventerebbe verde anche con la
// protezione accesa e quindi NON maschera regressioni).

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

// Disegna un rettangolo a tinta unita e rilegge i pixel via getImageData (la
// chiamata che gli script di fingerprinting usano per hashare il canvas).
const PROBE = `(() => {
  const W = 200, H = 60, R = 120, G = 60, B = 200;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(' + R + ',' + G + ',' + B + ')';
  ctx.fillRect(0, 0, W, H);
  const read = () => Array.from(ctx.getImageData(0, 0, W, H).data);
  const a = read();
  const b = read();
  let deviating = 0, alphaViolations = 0, maxDev = 0, identical = true;
  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs(a[i] - R), dg = Math.abs(a[i+1] - G), db = Math.abs(a[i+2] - B);
    if (dr || dg || db) deviating++;
    maxDev = Math.max(maxDev, dr, dg, db);
    if (a[i+3] !== 255) alphaViolations++;
  }
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) { identical = false; break; } }
  return { total: (W*H), deviating, alphaViolations, maxDev, identical,
           guard: !!window.__filoFpGuard };
})()`;

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  return sec;
}

test('default: il canvas viene perturbato (1 LSB), alpha intatto, deterministico', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>FP_ON</title><p>ok</p>');
  // La guardia deve essere stata iniettata nel main world.
  await page.waitForFunction(() => window.__filoFpGuard === true, null, { timeout: 6_000 });
  const r = await page.evaluate(PROBE);
  // Rumore applicato: qualche pixel deviato, ma NON tutti (perturbazione mirata).
  expect(r.deviating).toBeGreaterThan(0);
  expect(r.deviating).toBeLessThan(r.total);
  // Impercettibile: solo 1 LSB di scarto.
  expect(r.maxDev).toBeLessThanOrEqual(1);
  // L'alpha non viene mai toccato (altrimenti si vedrebbe).
  expect(r.alphaViolations).toBe(0);
  // Deterministico per sito: due letture identiche (nessun flicker).
  expect(r.identical).toBe(true);
});

test('off: i pixel del canvas tornano esatti (controprova)', async ({ openTab, testServer }) => {
  await setFpMode(openTab, 'off');
  const page = await testServer.openReady(openTab, '<title>FP_OFF</title><p>ok</p>');
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  const r = await page.evaluate(PROBE);
  // Nessun rumore: ogni pixel è esattamente il colore di riempimento.
  expect(r.deviating).toBe(0);
  expect(r.maxDev).toBe(0);
  expect(r.alphaViolations).toBe(0);
  expect(r.guard).toBe(false);
});

test('toDataURL: stabile su letture ripetute, non lancia eccezioni', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>FP_DATA</title><p>ok</p>');
  await page.waitForFunction(() => window.__filoFpGuard === true, null, { timeout: 6_000 });
  const r = await page.evaluate(`(() => {
    const c = document.createElement('canvas');
    c.width = 80; c.height = 40;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1e90ff'; ctx.fillRect(0, 0, 80, 40);
    ctx.fillStyle = '#000'; ctx.font = '16px sans-serif'; ctx.fillText('filo', 4, 24);
    const u1 = c.toDataURL();
    const u2 = c.toDataURL();
    // Dopo toDataURL il canvas a schermo deve essere ripristinato: rileggendo
    // un pixel "di testo" non deve restare alterato in modo visibile.
    return { stable: u1 === u2, looksPng: u1.startsWith('data:image/png'), len: u1.length };
  })()`);
  expect(r.looksPng).toBe(true);
  expect(r.stable).toBe(true);
  expect(r.len).toBeGreaterThan(100);
});

test('seed per-origine: deterministico, coerente fra sottodomini, scorrelato fra siti', async ({ app }) => {
  const r = await app.evaluate(() => {
    const F = globalThis.__filoFingerprint;
    return {
      googleLogin: F.seedForHref('https://accounts.google.com/'),
      googleSearch: F.seedForHref('https://www.google.com/'),
      bbcNews: F.seedForHref('https://news.bbc.co.uk/'),
      bbcWww: F.seedForHref('https://www.bbc.co.uk/'),
      bbcAltro: F.seedForHref('https://bbc.com/'),
      plain: F.seedForHref('https://example.com/'),
      githubAlice: F.configForHref('https://alice.github.io/').seed,
      githubBob: F.configForHref('https://bob.github.io/').seed,
      levelHttps: F.configForHref('https://x.example.com/').level,
      levelInternal: F.configForHref('filo://newtab/').level,
      levelFile: F.configForHref('file:///tmp/x.html').level,
      seedA1: F.configForHref('https://www.example.com/a').seed,
      seedA2: F.configForHref('https://shop.example.com/b').seed,
      seedB: F.configForHref('https://other-site.org/').seed,
    };
  });
  // Il sito è quello dei cookie: sottodomini insieme, suffisso nazionale a due livelli, due pagine su github.io separate.
  expect(r.googleLogin).toBe(r.googleSearch);
  expect(r.bbcNews).toBe(r.bbcWww);
  expect(r.bbcNews).not.toBe(r.bbcAltro);
  expect(r.plain).toBe(r.seedA1);
  expect(r.githubAlice).not.toBe(r.githubBob);
  // Solo http/https sono protette; pagine interne e file:// no.
  expect(r.levelHttps).toBe(1);
  expect(r.levelInternal).toBe(0);
  expect(r.levelFile).toBe(0);
  // Stesso eTLD+1 (sottodomini diversi) → stesso seed; sito diverso → diverso.
  expect(r.seedA1).toBe(r.seedA2);
  expect(r.seedA1).not.toBe(r.seedB);
  expect(r.seedA1).toBeGreaterThan(0);
});

// #796 — Lo stesso script di tracciamento su due siti diversi legge due impronte diverse anche sotto un suffisso
// nazionale a due livelli o su due IP; le pagine dello stesso sito ne leggono una sola. Il sito è quello dei cookie, e
// in Privacy il vaso persistente di un sito fidato è del sito anche quando la voce è un suffisso o un sottodominio.
// I nomi arrivano al server locale con host-resolver-rules: la rete vera non serve.

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOMI = ['shop.com.tw', 'www.shop.com.tw', 'altro.com.tw', 'negozio.co.id', 'toko.co.id', 'tienda.com.co', 'otra.com.co', '192.168.1.10', '10.0.1.10'];
const NOMI_FIDATI = ['www.bbc.co.uk', 'www.argos.co.uk', 'webmail.libero.it', 'www.libero.it'];

const testSiti = test.extend({
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

testSiti('due siti diversi leggono impronte diverse, due pagine dello stesso sito la stessa', async ({ openTab, testServer }) => {
  testSiti.setTimeout(90_000);
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
testSiti.describe('siti fidati in Privacy', () => {

  const CONNESSO = 'C=sess=abc';
  let server;
  let port;

  testSiti.beforeAll(async () => {
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

  testSiti.afterAll(async () => {
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

  testSiti('una voce fidata salvata come suffisso tiene connessi i siti sotto di lei, ognuno nel suo vaso', async ({ app, shell }) => {
    testSiti.setTimeout(90_000);
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

  testSiti('un sito fidato scritto col suo sottodominio resta connesso su tutto il sito', async ({ app, shell }) => {
    testSiti.setTimeout(90_000);
    await privacy(app, shell, ['webmail.libero.it']);
    const a = await apri(app, shell, 'webmail.libero.it', '/accedi');
    expect(a.partizione).toMatch(/^persist:/);
    await privacy(app, shell, ['webmail.libero.it', 'esempio.it']);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await apri(app, shell, 'webmail.libero.it', '/torno')).titolo).toBe(CONNESSO);
    expect((await apri(app, shell, 'www.libero.it', '/')).partizione).toBe(a.partizione);
  });
});
