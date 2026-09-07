// Verifica avversariale #429 — terzo blocco: quanto spazio resta davvero al
// nome, e che colore prende la scheda in primo piano su un sito dal marchio
// colorato e la cima chiara.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

// 1. Nomi lunghi con mezza barra vuota: si allarga la scheda o si taglia?
test('due schede su 1280px con nomi lunghi: quanto spazio avanza e quanto si taglia', async ({ shell, testServer }) => {
  const lungo = 'Come scegliere la bicicletta giusta: guida alle misure e ai materiali';
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>${lungo}</title><body style="margin:0;background:#fff">x</body>`));
  await expect.poll(async () => shell.evaluate(() => document.querySelectorAll('.tab').length), { timeout: 12_000 }).toBe(2);
  await shell.waitForTimeout(1200);

  const m = await shell.evaluate(() => {
    const strip = document.querySelector('.tabs');
    const row = document.querySelector('.tab-row');
    const el = document.querySelector('.tab.active');
    const t = el.querySelector('.title');
    return {
      libero: Math.round(row.getBoundingClientRect().width - strip.getBoundingClientRect().width),
      tabW: Math.round(el.getBoundingClientRect().width),
      titleW: Math.round(t.getBoundingClientRect().width),
      titleServe: t.scrollWidth,
      testo: t.textContent,
    };
  });
  console.log('nomi lunghi:', JSON.stringify(m));
  await shell.screenshot({ path: join(SHOTS, 'v429g12-nome-lungo.png'), clip: { x: 0, y: 0, width: 1280, height: 44 } });
  // MISURA (giro 12): al nome servono 434px, ne ha 256, e nella riga avanzano
  // 684px liberi — la scheda non supera mai i 320px. È la domanda già portata
  // all'owner nel giro scorso: non assertita, solo misurata.
  console.log(`al nome servono ${m.titleServe}px, ne ha ${m.titleW}, liberi ${m.libero}px`);
});

// 2. Hover sulla scheda più stretta possibile (finestra al minimo, 8 schede).
test('finestra al minimo: cosa resta del nome sotto il mouse', async ({ shell, app, testServer }) => {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.setSize(720, 600);
  });
  await shell.waitForTimeout(400);
  for (const n of ['Meteo Italia', 'Mercati', 'Musica', 'Mappe', 'Manuale', 'Messaggi', 'Marketplace']) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>${n}</title><body style="margin:0;background:#fff">x</body>`));
  }
  await expect.poll(async () => shell.evaluate(() => document.querySelectorAll('.tab').length), { timeout: 15_000 }).toBe(8);
  await shell.waitForTimeout(800);
  const p = await shell.evaluate(() => {
    const el = [...document.querySelectorAll('.tab')].filter((t) => !t.classList.contains('active'))[2];
    const t = el.querySelector('.title');
    const r = el.getBoundingClientRect();
    return { nome: t.textContent, titleW: Math.round(t.getBoundingClientRect().width), w: Math.round(r.width), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await shell.mouse.move(3, 3);
  await shell.mouse.move(p.x, p.y);
  await shell.waitForTimeout(500);
  const d = await shell.evaluate(() => {
    const el = document.querySelector('.tab:hover');
    if (!el) return null;
    const t = el.querySelector('.title');
    const c = el.querySelector('.close');
    return { titleW: Math.round(t.getBoundingClientRect().width), closeW: c ? Math.round(c.getBoundingClientRect().width) : 0, testo: t.textContent };
  });
  console.log('minimo — prima:', JSON.stringify(p), 'sotto il mouse:', JSON.stringify(d));
  await shell.screenshot({ path: join(SHOTS, 'v429g12-720-hover.png'), clip: { x: 0, y: 0, width: 720, height: 44 } });
});

// 3. Sito realistico: cima bianca, logo colorato (il caso più comune del web).
test('cima chiara + logo colorato: che colore prende la scheda in primo piano', async ({ shell, testServer }) => {
  // Favicon multicolore come quello di un motore di ricerca.
  const fav = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">'
    + '<rect width="16" height="16" fill="#ffffff"/>'
    + '<circle cx="8" cy="8" r="6" fill="rgb(30,110,230)"/>'
    + '<path d="M8 2 A6 6 0 0 1 14 8 L8 8 Z" fill="rgb(230,60,40)"/></svg>',
  );
  const url = testServer.html(
    `<!doctype html><html><head><link rel="icon" href="data:image/svg+xml,${fav}">`
    + '<meta name="theme-color" content="#ffffff"><title>Motore di ricerca</title></head>'
    + '<body style="margin:0;background:#ffffff"><div style="height:70px;background:#ffffff"></div>'
    + '<div style="height:1200px;background:#ffffff"></div></body></html>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await shell.waitForTimeout(4000);
  const v = await shell.evaluate(() => {
    const el = document.querySelector('.tab.active');
    return { bg: getComputedStyle(el).backgroundColor, tint: el.style.getPropertyValue('--tab-active').trim() };
  });
  console.log('scheda attiva su motore di ricerca:', JSON.stringify(v));
  await shell.screenshot({ path: join(SHOTS, 'v429g12-motore.png'), clip: { x: 0, y: 0, width: 700, height: 44 } });
});

// 4. Lo stesso, ma con la pagina VISIBILE sotto: si vede la cucitura?
test('cattura completa: barra + pagina bianca con logo colorato', async ({ shell, app, testServer }) => {
  const fav = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="rgb(220,20,20)"/></svg>');
  const url = testServer.html(
    `<!doctype html><html><head><link rel="icon" href="data:image/svg+xml,${fav}">`
    + '<title>Video del giorno</title></head>'
    + '<body style="margin:0;background:#ffffff;font:16px system-ui">'
    + '<div style="height:56px;background:#ffffff;border-bottom:1px solid #eee;display:flex;align-items:center;padding:0 16px">Barra del sito</div>'
    + '<div style="height:1200px"></div></body></html>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await shell.waitForTimeout(4000);
  await shell.screenshot({ path: join(SHOTS, 'v429g12-cucitura-shell.png') });
  const pag = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
  if (pag) await pag.screenshot({ path: join(SHOTS, 'v429g12-cucitura-pagina.png'), clip: { x: 0, y: 0, width: 900, height: 100 } });
});
