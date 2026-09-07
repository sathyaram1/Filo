// #429 — seconda tornata: finestra stretta, tema scuro, home, spazio sprecato,
// e il piedino della scheda attiva quando è l'ultima della striscia.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

const TOP_COLOR_FN = () => {
  const parse = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    if (p.length >= 4 && p[3] < 0.5) return null;
    return [p[0], p[1], p[2]];
  };
  const bgOf = (el) => {
    let n = el; let hops = 0;
    while (n && n.nodeType === 1 && hops < 6) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c) return c;
      n = n.parentElement; hops++;
    }
    return null;
  };
  const w = Math.max(1, window.innerWidth);
  const acc = [0, 0, 0]; let n = 0;
  for (const y of [6, 16, 28]) for (const x of [w * 0.2, w * 0.5, w * 0.8]) {
    let el = null;
    try { el = document.elementFromPoint(x, y); } catch (_) {}
    const c = el ? bgOf(el) : null;
    if (c) { acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; n++; }
  }
  if (!n) {
    const c = parse(getComputedStyle(document.body).backgroundColor);
    if (c) { acc[0] = c[0]; acc[1] = c[1]; acc[2] = c[2]; n = 1; }
  }
  if (!n) return null;
  return [Math.round(acc[0] / n), Math.round(acc[1] / n), Math.round(acc[2] / n)];
};

const TABS_STATE = () => {
  const row = document.querySelector('.tab-row');
  const strip = document.querySelector('.tabs');
  const plus = document.querySelector('.tab-new');
  const tabs = [...document.querySelectorAll('.tab')].map((el) => {
    const t = el.querySelector('.title');
    const r = el.getBoundingClientRect();
    return {
      id: el.dataset.id,
      active: el.classList.contains('active'),
      text: t ? t.textContent : '',
      w: Math.round(r.width),
      left: Math.round(r.left), right: Math.round(r.right),
      troncato: t ? t.scrollWidth > t.clientWidth + 1 : false,
      bg: getComputedStyle(el).backgroundColor,
      fg: getComputedStyle(el).color,
      tip: el.dataset.tip ? el.dataset.tip.length : 0,
    };
  });
  const pr = plus ? plus.getBoundingClientRect() : null;
  return {
    tabs,
    rowW: Math.round(row.getBoundingClientRect().width),
    stripW: Math.round(strip.getBoundingClientRect().width),
    stripScroll: strip.scrollWidth,
    stripClient: strip.clientWidth,
    plus: pr ? { left: Math.round(pr.left), right: Math.round(pr.right), w: Math.round(pr.width) } : null,
    winW: window.innerWidth,
  };
};

async function apriInterna(shell, app, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return w.url().startsWith(url); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded').catch(() => {}); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('non aperta: ' + url);
}

async function resize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    if (win) win.setBounds({ x: 0, y: 0, width: s.w, height: s.h });
  }, { w, h });
}

test.describe.configure({ mode: 'serial' });

test('#429/7 — spazio sprecato: titoli lunghi tagliati con mezza barra vuota', async ({ shell, testServer }) => {
  const t1 = 'Rassegna stampa del mattino — cronaca, politica ed economia';
  const t2 = 'Ricette della nonna: la torta di mele passo per passo';
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>${t1}</title><body style="margin:0;background:#fff">x</body>`));
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>${t2}</title><body style="margin:0;background:#fff">y</body>`));
  await shell.waitForTimeout(2500);
  const st = await shell.evaluate(TABS_STATE);
  const ultimo = st.tabs[st.tabs.length - 1];
  const liberi = st.rowW - ultimo.right;
  console.log('finestra', st.winW, 'riga', st.rowW, 'ultima scheda finisce a', ultimo.right, '→ pixel liberi a destra:', liberi);
  console.log(JSON.stringify(st.tabs.map((t) => ({ text: t.text, w: t.w, troncato: t.troncato, active: t.active })), null, 1));
  await shell.screenshot({ path: join(SHOTS, 'v429-spazio-sprecato.png'), clip: { x: 0, y: 0, width: st.winW, height: 44 } });
});

test('#429/8 — finestra stretta: le schede non coprono + e controlli finestra', async ({ shell, app, testServer }) => {
  for (let i = 0; i < 6; i++) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>Scheda ${i} titolo medio</title><body style="margin:0;background:#eee">z</body>`));
  }
  await shell.waitForTimeout(2500);
  for (const w of [1000, 700, 520, 420]) {
    await resize(app, w, 700);
    await shell.waitForTimeout(600);
    const st = await shell.evaluate(TABS_STATE);
    const ultimo = st.tabs[st.tabs.length - 1];
    console.log(`--- larghezza ${w}: riga ${st.rowW}, striscia ${st.stripW} (scroll ${st.stripScroll}/${st.stripClient}), + a ${st.plus && st.plus.left}, ultima scheda a ${ultimo.right}`);
    console.log(JSON.stringify(st.tabs.map((t) => ({ t: t.text.slice(0, 14), w: t.w, tr: t.troncato, a: t.active }))));
    await shell.screenshot({ path: join(SHOTS, `v429-stretta-${w}.png`), clip: { x: 0, y: 0, width: Math.min(w, st.winW), height: 44 } });
    // il "+" deve restare dentro la finestra e non essere coperto
    if (st.plus) expect(st.plus.right, `+ dentro la finestra a ${w}px`).toBeLessThanOrEqual(st.winW + 1);
  }
  await resize(app, 1280, 840);
});

test('#429/9 — tema scuro: la scheda attiva resta la continuazione della pagina', async ({ shell, app }) => {
  await shell.emulateMedia({ colorScheme: 'dark' });
  const page = await apriInterna(shell, app, 'filo://manage/manage.html');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await shell.waitForTimeout(2500);
  const top = await page.evaluate(TOP_COLOR_FN);
  const st = await shell.evaluate(TABS_STATE);
  const attiva = st.tabs.find((t) => t.active);
  console.log('SCURO cima', top, 'scheda', attiva.bg, 'testo', attiva.fg);
  await shell.screenshot({ path: join(SHOTS, 'v429-scuro.png'), clip: { x: 0, y: 0, width: st.winW, height: 44 } });
  const m = /rgba?\(([^)]+)\)/.exec(attiva.bg);
  const p = m[1].split(',').map(Number);
  const d = Math.max(Math.abs(p[0] - top[0]), Math.abs(p[1] - top[1]), Math.abs(p[2] - top[2]));
  console.log('delta scuro', d);
  expect(d, 'scheda attiva = cima pagina anche al buio').toBeLessThanOrEqual(8);
});

test('#429/10 — la home (nuova scheda) è anch\'essa una continuazione', async ({ shell, app }) => {
  await shell.waitForTimeout(1500);
  const st0 = await shell.evaluate(TABS_STATE);
  const home = st0.tabs[0];
  console.log('home attiva?', home.active, 'bg', home.bg);
  // clic sulla home
  await shell.evaluate((id) => document.querySelector(`.tab[data-id="${id}"]`).click(), home.id);
  await shell.waitForTimeout(2500);
  const st = await shell.evaluate(TABS_STATE);
  const attiva = st.tabs.find((t) => t.active);
  const pagina = app.windows().find((w) => { try { return w.url().includes('newtab') || w.url().includes('dashboard'); } catch (_) { return false; } });
  const top = pagina ? await pagina.evaluate(TOP_COLOR_FN) : null;
  console.log('HOME: cima', top, 'scheda attiva', attiva.text, attiva.bg);
  await shell.screenshot({ path: join(SHOTS, 'v429-home.png'), clip: { x: 0, y: 0, width: st.winW, height: 44 } });
});

test('#429/11 — striscia scrollabile senza motivo con poche schede (piedino tagliato?)', async ({ shell, app }) => {
  await apriInterna(shell, app, 'filo://manage/manage.html');
  await shell.waitForTimeout(1500);
  const st = await shell.evaluate(TABS_STATE);
  console.log('striscia: scrollWidth', st.stripScroll, 'clientWidth', st.stripClient, 'riga', st.rowW);
  const over = st.stripScroll - st.stripClient;
  console.log('overflow orizzontale della striscia con 2 schede:', over);
  // prova a scrollarla come farebbe la rotellina
  const dopo = await shell.evaluate(() => {
    const s = document.querySelector('.tabs');
    s.scrollLeft = 999;
    const v = s.scrollLeft;
    s.scrollLeft = 0;
    return v;
  });
  console.log('scrollLeft raggiungibile con 2 schede:', dopo);
  await shell.screenshot({ path: join(SHOTS, 'v429-piedino.png'), clip: { x: 240, y: 0, width: 400, height: 44 } });
});
