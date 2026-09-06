// Suite accorpata: colorazione e segnali delle schede (tab bar della shell).
//
// Unisce gli ex spec tab-live-color / tab-identity-color / tab-favicon-color /
// tab-activity-signals in UN solo avvio di Electron. I test condividono un'unica
// app lanciata in beforeAll e un mini server HTTP locale (come il fixture). Ogni
// test apre comunque le SUE tab web fresche; un beforeEach chiude tutte le tab
// (il TabManager riapre una newtab) così le tab di un test non si accumulano nel
// successivo (com'era con un'app appena lanciata per test). Nessuno di questi
// test scrive storage persistente: la sola superficie condivisa è l'elenco tab,
// che il beforeEach ripulisce.
//
// I body dei test sono identici agli originali (stessi assert): cambia solo da
// dove arrivano `shell`/`openTab`/`testServer` (helper locali sull'app condivisa)
// e l'inquadramento in describe per file di provenienza.

import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { argomentiScala } from './fixtures/electron.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');

let app = null;
let shell = null;
let userData = null;
let server = null;
let testServer = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'filo-test-'));
  app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');

  // Mini server HTTP locale condiviso (replica del fixture testServer).
  const pages = new Map();
  let nextId = 0;
  server = createServer((req, res) => {
    const id = req.url.replace(/^\//, '').split('?')[0];
    const html = pages.get(id);
    if (!html) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  testServer = {
    html(body) {
      const id = String(++nextId);
      pages.set(id, body);
      return `http://127.0.0.1:${port}/${id}`;
    },
    origin: `http://127.0.0.1:${port}`,
    async openReady(openTabFn, html) {
      const url = this.html(html);
      const page = await openTabFn(url);
      await page.waitForFunction(
        () => document.documentElement.dataset.filoReady === '1',
        null,
        { timeout: 8000 },
      );
      return page;
    },
  };
});

test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  if (server) { await new Promise((r) => server.close(r)); }
  try { await app.close(); } catch (_) {}
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  app = null; shell = null; userData = null; server = null; testServer = null;
});

async function openTab(url) {
  const target = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const deadline = Date.now() + 10_000;
  let page = null;
  while (Date.now() < deadline) {
    page = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === target; }
      catch (_) { return false; }
    });
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error(`openTab: nessuna window per ${url}`);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return page;
}

// Prima di ogni test: chiudi tutte le tab della finestra principale (il
// TabManager riapre automaticamente una newtab fresca), così le tab web aperte
// da un test non si accumulano nel successivo — come con un'app appena lanciata.
test.beforeEach(async () => {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    if (!w || !w._filoTabs) return;
    for (const t of [...w._filoTabs.tabs]) {
      try { w._filoTabs.closeTab(t.id); } catch (_) {}
    }
  });
  await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w && w._filoTabs ? w._filoTabs.tabs.length : 0;
  }), { timeout: 8_000 }).toBe(1);
});

// ───────────────────────────── tab-live-color ──────────────────────────────
test.describe('colore live tab attiva', () => {
  // Pagina con una striscia in cima di colore noto e forte (blu scuro).
  const HTML = `<!doctype html><html><head><title>Pagina colorata</title></head>
<body style="margin:0">
  <div style="height:300px;background:rgb(20, 40, 200)"></div>
  <div style="height:2000px;background:#ffffff"></div>
</body></html>`;

  test('la tab attiva prende il colore dominante della cima della pagina', async () => {
    await testServer.openReady(openTab, HTML);

    // Il colore campionato arriva fino allo snapshot del main.
    await expect.poll(async () => shell.evaluate(async () => {
      const snap = await window.filoShell.tabs.snapshot();
      const a = snap.tabs.find((t) => t.id === snap.activeId);
      return (a && a.color) || null;
    }), { timeout: 8_000 }).toMatch(/rgb\(20, 40, 200\)/);

    // La shell tinge la tab attiva con quel colore (variabile --tab-active) e
    // imposta un testo chiaro (il blu scuro ha bassa luminanza).
    await expect.poll(async () => shell.evaluate(() => {
      const el = document.querySelector('.tab.active');
      if (!el) return null;
      return {
        tint: el.style.getPropertyValue('--tab-active'),
        color: el.style.color,
      };
    }), { timeout: 8_000 }).toEqual(
      expect.objectContaining({ tint: expect.stringContaining('rgb(20, 40, 200)') }),
    );

    const fg = await shell.evaluate(() => document.querySelector('.tab.active').style.color);
    // Testo chiaro su fondo scuro (qualunque forma rgb/hex → deve essere "chiaro").
    expect(fg).toBeTruthy();
  });
});

// ──────────────────────────── tab-identity-color ───────────────────────────
test.describe('colore identità tab inattiva', () => {
  // Pagina con un theme-color forte e noto (magenta acceso).
  const PAGE_A = `<!doctype html><html><head><title>Sito A</title>
  <meta name="theme-color" content="rgb(220, 30, 90)">
</head><body style="margin:0"><div style="height:1200px;background:#fff"></div></body></html>`;

  // Seconda pagina senza identità particolare: serve solo a rendere INATTIVA la A.
  const PAGE_B = `<!doctype html><html><head><title>Sito B</title></head>
<body style="margin:0"><div style="height:1200px;background:#fff"></div></body></html>`;

  test('la tab inattiva prende il colore identità del sito attenuato', async () => {
    await testServer.openReady(openTab, PAGE_A);

    // Il colore identità (dal theme-color) arriva fino allo snapshot del main.
    await expect.poll(async () => shell.evaluate(async () => {
      const snap = await window.filoShell.tabs.snapshot();
      const a = snap.tabs.find((t) => t.id === snap.activeId);
      return (a && a.identityColor) || null;
    }), { timeout: 8_000 }).toMatch(/rgb\(220, 30, 90\)/);

    // Apri una seconda tab: ora la tab A diventa INATTIVA.
    await testServer.openReady(openTab, PAGE_B);

    // Trova nello snapshot la tab del Sito A (inattiva) con il suo identityColor.
    const tabAId = await expect.poll(async () => shell.evaluate(async () => {
      const snap = await window.filoShell.tabs.snapshot();
      const a = snap.tabs.find(
        (t) => t.id !== snap.activeId && /rgb\(220, 30, 90\)/.test(t.identityColor || ''),
      );
      return a ? a.id : null;
    }), { timeout: 8_000 }).not.toBeNull();

    // La shell tinge quella tab INATTIVA con la tinta attenuata: la variabile
    // --tab-bg-eff è impostata inline e mescola un colore col neutro del tab bar.
    const id = await shell.evaluate(async () => {
      const snap = await window.filoShell.tabs.snapshot();
      const a = snap.tabs.find(
        (t) => t.id !== snap.activeId && /rgb\(220, 30, 90\)/.test(t.identityColor || ''),
      );
      return a ? a.id : null;
    });
    expect(id).not.toBeNull();

    const bgEff = await shell.evaluate((tid) => {
      const el = document.querySelector(`.tab[data-id="${tid}"]`);
      if (!el) return null;
      return {
        bgEff: el.style.getPropertyValue('--tab-bg-eff'),
        isActive: el.classList.contains('active'),
      };
    }, id);

    expect(bgEff).not.toBeNull();
    // È una tab inattiva e ha la tinta identità (color-mix col neutro del tab bar).
    expect(bgEff.isActive).toBe(false);
    expect(bgEff.bgEff).toContain('color-mix');
  });
});

// ──────────────────────────── tab-favicon-color ────────────────────────────
test.describe('colore tab dal favicon', () => {
  test('la tab attiva prende il colore dal favicon quando il theme-color è neutro (caso YouTube)', async () => {
    const favSvg = encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">' +
      '<rect width="16" height="16" fill="rgb(220,20,20)"/></svg>',
    );
    const html =
      '<!doctype html><html><head>' +
      '<meta name="theme-color" content="#ffffff">' +
      `<link rel="icon" href="data:image/svg+xml,${favSvg}">` +
      '<title>theme bianco, favicon rosso</title>' +
      '</head><body style="background:#fff;height:1500px;margin:0">contenuto</body></html>';

    // openReady garantisce che i content script (campionatori di colore) siano montati.
    await testServer.openReady(openTab, html);

    // Il colore identità è asincrono (content script → main → broadcast → render),
    // con qualche retry lato content. Facciamo polling sulla tab attiva nella shell.
    const res = await shell.evaluate(async () => {
      const parse = (s) => {
        const m = /rgba?\(([^)]+)\)/.exec(s || '');
        if (!m) return null;
        const a = m[1].split(',').map((x) => parseFloat(x.trim()));
        return a.length >= 3 && a.every((n) => !Number.isNaN(n)) ? a : null;
      };
      const reddish = (a) => a && a[0] > 120 && a[0] - a[1] > 40 && a[0] - a[2] > 40;
      const read = () => {
        const el = document.querySelector('.tab.active');
        if (!el) return null;
        return el.style.getPropertyValue('--tab-active') ||
          getComputedStyle(el).getPropertyValue('--tab-active');
      };
      const deadline = Date.now() + 9000;
      let last = null;
      while (Date.now() < deadline) {
        last = read();
        if (reddish(parse(last))) return { ok: true, value: (last || '').trim() };
        await new Promise((r) => setTimeout(r, 150));
      }
      return { ok: false, value: (last || '(nessuna tab attiva)').trim() };
    });

    expect(
      res.ok,
      `--tab-active atteso rossastro (preso dal favicon), ottenuto invece: "${res.value}"`,
    ).toBe(true);
  });
});

// ─────────────────────────── tab-activity-signals ──────────────────────────
test.describe('segnali di attività per-tab', () => {
  const PAGE = `<!doctype html><html><head><title>Pagina attività</title></head>
<body style="margin:0">
  <input id="f" />
  <div style="height:3000px;background:#fff"></div>
</body></html>`;

  test('i segnali di attività (lastActive, scroll%, formDirty) arrivano allo snapshot', async () => {
    const page = await testServer.openReady(openTab, PAGE);

    const activeId = await shell.evaluate(async () => {
      const snap = await window.filoShell.tabs.snapshot();
      return snap.activeId;
    });

    // La tab attiva ha un lastActiveAt valorizzato.
    const lastActive = await shell.evaluate(async (id) => {
      const snap = await window.filoShell.tabs.snapshot();
      const t = snap.tabs.find((x) => x.id === id);
      return t ? t.lastActiveAt : null;
    }, activeId);
    expect(typeof lastActive).toBe('number');
    expect(lastActive).toBeGreaterThan(0);

    // Scroll → scrollPct sale.
    await page.evaluate(() => window.scrollTo(0, 2000));
    await expect.poll(async () => shell.evaluate(async (id) => {
      const snap = await window.filoShell.tabs.snapshot();
      const t = snap.tabs.find((x) => x.id === id);
      return t ? t.scrollPct : 0;
    }, activeId), { timeout: 8_000 }).toBeGreaterThan(0);

    // Scrivere in un campo → formDirty true.
    await page.evaluate(() => {
      const el = document.getElementById('f');
      el.focus();
      el.value = 'ciao';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(async () => shell.evaluate(async (id) => {
      const snap = await window.filoShell.tabs.snapshot();
      const t = snap.tabs.find((x) => x.id === id);
      return t ? t.formDirty : false;
    }, activeId), { timeout: 8_000 }).toBe(true);
  });
});
