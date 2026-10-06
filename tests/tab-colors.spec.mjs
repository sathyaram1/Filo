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
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { argomentiScala } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');

let app = null;
let shell = null;
let userData = null;
let server = null;
let testServer = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userData = cartellaTemporanea('filo-test-');
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

    // Il titolo si legge sul blu scuro: 4,5:1, la regola di tutte le schede colorate (#821).
    const ratio = await shell.evaluate(() => {
      const el = document.querySelector('.tab.active');
      const nums = (c) => (/rgba?\(([^)]+)\)/.exec(c) || [, ''])[1].split(',').slice(0, 3).map(Number);
      const lum = ([r, g, b]) => {
        const l = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
      };
      const a = lum(nums(getComputedStyle(el.querySelector('.title')).color)), b = lum([20, 40, 200]);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
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

  test('la tab inattiva prende il colore identità del sito', async () => {
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

    // La shell tinge quella tab INATTIVA: --tab-bg-eff inline col colore già
    // mescolato al neutro del tab bar (la formula la prova il describe #821).
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
    expect(bgEff.isActive).toBe(false);
    expect(bgEff.bgEff).toMatch(/^rgb\(/);
  });
});

// ───────────────────── tinta viva delle schede non attive (#821) ─────────────────────
test.describe('tinta viva delle schede non attive', () => {
  const favSvg = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">' +
    '<rect width="16" height="16" fill="rgb(220,20,20)"/></svg>',
  );
  const PAGE_RED = '<!doctype html><html><head>' +
    `<link rel="icon" href="data:image/svg+xml,${favSvg}">` +
    '<title>Sito rosso</title></head><body style="margin:0;height:1200px">rosso</body></html>';
  const PAGE_OTHER = '<!doctype html><html><head><title>Altro sito</title></head>' +
    '<body style="margin:0;height:1200px">altro</body></html>';

  const setSettings = (settings) => shell.evaluate(
    (st) => window.filoShell.message({ type: 'update_settings', settings: st }), settings);

  // Fondo, barra e titolo della scheda rossa come li mostra lo schermo.
  const readRedTab = () => shell.evaluate(() => {
    const el = document.querySelector('.tab[data-tip="Sito rosso"]');
    if (!el || el.classList.contains('active')) return null;
    const probe = document.createElement('div');
    probe.style.background = 'var(--tab-bg)';
    document.body.appendChild(probe);
    const bar = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const nums = (c) => (/rgba?\(([^)]+)\)/.exec(c) || [, ''])[1].split(',').slice(0, 3).map(Number);
    return {
      bg: nums(getComputedStyle(el).backgroundColor),
      bar: nums(bar),
      title: nums(getComputedStyle(el.querySelector('.title')).color),
      close: nums(getComputedStyle(el.querySelector('.close')).color),
      tinted: el.classList.contains('tinted'),
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
    };
  });

  const lum = ([r, g, b]) => {
    const l = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
  };
  const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const formula = (bar, op) => [255, 0, 0].map((v, i) => v * op + bar[i] * (1 - op));
  const near = (got, want) => got.every((v, i) => Math.abs(v - want[i]) <= 2);

  async function openRedInactive() {
    await testServer.openReady(openTab, PAGE_RED);
    await expect.poll(async () => shell.evaluate(async () => {
      const snap = await window.filoShell.tabs.snapshot();
      const a = snap.tabs.find((t) => t.id === snap.activeId);
      return (a && a.identityColor) || null;
    }), { timeout: 9_000 }).toBe('rgb(255, 0, 0)');
    await testServer.openReady(openTab, PAGE_OTHER);
  }

  // La scheda rossa ha il fondo della formula della spec, e il titolo si legge.
  async function expectFormula(op, dark) {
    let last = null;
    await expect.poll(async () => {
      last = await readRedTab();
      return !!last && last.dark === dark && near(last.bg, formula(last.bar, op));
    }, { timeout: 8_000 }).toBe(true);
    expect(contrast(last.title, last.bg), `titolo ${last.title} su ${last.bg}`).toBeGreaterThanOrEqual(4.5);
    expect(last.close).toEqual(last.title);
    return last;
  }

  test.afterEach(async () => {
    await shell.emulateMedia({ colorScheme: 'light' });
    const TC = await app.evaluate(() => globalThis.SN_TAB_COLOR.defaultParams());
    await setSettings({ tabColor: TC, theme: 'system' });
  });

  test('coi predefiniti la scheda di un favicon rosso è rossa viva, e opacita_tab la governa', async () => {
    await setSettings({ theme: 'light' });
    await openRedInactive();

    const def = await expectFormula(0.6, false);
    expect(def.tinted).toBe(true);
    // Vivace: il canale rosso domina, non il grigiastro della vecchia saturazione al 18%.
    expect(def.bg[0] - Math.max(def.bg[1], def.bg[2])).toBeGreaterThan(120);

    // Saturazione e opacità al massimo: rosso YouTube pieno.
    await setSettings({ tabColor: { saturazione_tab: 1, opacita_tab: 1 } });
    const full = await expectFormula(1, false);
    expect(full.bg).toEqual([255, 0, 0]);

    // Il preset di «colori più vivaci nelle tab» si vede rispetto ai predefiniti.
    await setSettings({ tabColor: { saturazione_tab: 1, opacita_tab: 0.9 } });
    const vivid = await expectFormula(0.9, false);
    expect(Math.hypot(...vivid.bg.map((v, i) => v - def.bg[i]))).toBeGreaterThan(60);

    // Opacità 0: nessun colore, il fondo è quello della barra.
    await setSettings({ tabColor: { opacita_tab: 0 } });
    await expect.poll(async () => {
      const r = await readRedTab();
      return !!r && !r.tinted && near(r.bg, r.bar);
    }, { timeout: 8_000 }).toBe(true);
  });

  test('tema scuro: stessa formula sul fondo scuro della barra, titolo leggibile anche in hover', async () => {
    await openRedInactive();
    await expectFormula(0.6, false);

    // Il cambio di tema da solo ridipinge la scheda (Playwright tiene la shell in chiaro: si emula).
    await shell.emulateMedia({ colorScheme: 'dark' });
    const dark = await expectFormula(0.6, true);
    expect(lum(dark.bar)).toBeLessThan(0.05);

    await shell.hover('.tab[data-tip="Sito rosso"] .title');
    await expect.poll(async () => {
      const r = await readRedTab();
      return !!r && !near(r.bg, dark.bg) && contrast(r.title, r.bg) >= 4.5;
    }, { timeout: 5_000 }).toBe(true);
    await shell.mouse.move(0, 200);

    await shell.emulateMedia({ colorScheme: 'light' });
    await expectFormula(0.6, false);
  });

  // D63: la scheda attiva prende sempre la cima della pagina, mai il marchio; il testo si sceglie per contrasto (#821).
  test('scheda attiva: cima bianca resta bianca col favicon rosso, cima rossa è rossa; titolo a 4,5:1 e crocetta a 3:1, nei due temi', async () => {
    const readActive = (titolo) => shell.evaluate((tt) => {
      const el = document.querySelector(`.tab.active[data-tip="${tt}"]`);
      if (!el) return null;
      const nums = (c) => (/rgba?\(([^)]+)\)/.exec(c) || [, ''])[1].split(',').slice(0, 3).map(Number);
      return {
        bg: nums(getComputedStyle(el).backgroundColor),
        title: nums(getComputedStyle(el.querySelector('.title')).color),
        close: nums(getComputedStyle(el.querySelector('.close')).color),
      };
    }, titolo);
    const casi = [
      { titolo: 'Cima bianca', bg: [255, 255, 255], html: PAGE_RED.replace('Sito rosso', 'Cima bianca').replace('margin:0;', 'margin:0;background:#fff;') },
      { titolo: 'Cima rossa', bg: [255, 0, 0], html: PAGE_RED.replace('Sito rosso', 'Cima rossa').replace('margin:0;', 'margin:0;background:rgb(255,0,0);') },
    ];
    for (const caso of casi) {
      await testServer.openReady(openTab, caso.html);
      await expect.poll(async () => shell.evaluate(async () => {
        const snap = await window.filoShell.tabs.snapshot();
        const a = snap.tabs.find((t) => t.id === snap.activeId);
        return (a && a.identityColor) || null;
      }), { timeout: 9_000 }).toBe('rgb(255, 0, 0)');
      for (const scheme of ['light', 'dark']) {
        await shell.emulateMedia({ colorScheme: scheme });
        let r = null;
        await expect.poll(async () => {
          r = await readActive(caso.titolo);
          return !!r && near(r.bg, caso.bg) && contrast(r.title, r.bg) >= 4.5;
        }, { timeout: 9_000 }).toBe(true);
        expect(contrast(r.close, r.bg), `${caso.titolo}, ${scheme}: crocetta ${r.close} su ${r.bg}`).toBeGreaterThanOrEqual(3);
      }
      await shell.emulateMedia({ colorScheme: 'light' });
    }
  });
});

// ──────────────────────────── tab-favicon-color ────────────────────────────
test.describe('colore tab dal favicon', () => {
  test('la tab attiva resta del colore della cima anche se bianca, col favicon rosso (caso YouTube, D63)', async () => {
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

    await testServer.openReady(openTab, html);
    // Prima arriva il colore del sito dal favicon: solo dopo un ripiego sul marchio si vedrebbe.
    await expect.poll(async () => shell.evaluate(async () => {
      const snap = await window.filoShell.tabs.snapshot();
      const a = snap.tabs.find((t) => t.id === snap.activeId);
      return (a && a.identityColor) || null;
    }), { timeout: 9_000 }).toMatch(/^rgb\(255, 0, 0\)$/);
    await shell.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const tint = await shell.evaluate(() => {
      const el = document.querySelector('.tab.active');
      return el ? el.style.getPropertyValue('--tab-active').trim() : '(nessuna tab attiva)';
    });
    expect(tint, '--tab-active atteso bianco, la cima della pagina').toBe('rgb(255, 255, 255)');
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
