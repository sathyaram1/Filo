// Verifica avversariale #429 — secondo blocco: cuciture, hover, suggerimento,
// e le strade "adiacenti" che l'utente proverebbe.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

async function paginaDi(app, url, timeout = 12_000) {
  const fine = Date.now() + timeout;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina mai comparsa: ' + url);
}

// 1. La cucitura vera: cattura della finestra intera su Gestione.
for (const tema of ['light', 'dark']) {
  test(`[${tema}] cattura: barra schede + cima di Gestione`, async ({ shell, app }) => {
    await shell.emulateMedia({ colorScheme: tema });
    await shell.evaluate(() => window.filoShell.tabs.open('filo://manage/manage.html'));
    const pag = await paginaDi(app, 'filo://manage/manage.html');
    await pag.emulateMedia({ colorScheme: tema });
    await shell.waitForTimeout(3000);
    await shell.screenshot({ path: join(SHOTS, `v429g12-shell-${tema}.png`) });
    await pag.screenshot({ path: join(SHOTS, `v429g12-pagina-${tema}.png`), clip: { x: 0, y: 0, width: 900, height: 120 } });
  });
}

// 2. Il nome sotto il mouse: su una scheda stretta la crocetta torna e si
//    riprende i pixel. Quanto ne resta al nome?
test('hover su una scheda stretta: quanto resta del nome', async ({ shell, testServer }) => {
  const nomi = ['Meteo Italia', 'Mercati e finanza', 'Musica classica', 'Mappe e percorsi',
    'Manuale utente', 'Messaggi', 'Marketplace', 'Modelli 3D', 'Motori', 'Mostra'];
  for (const n of nomi) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>${n}</title><body style="margin:0;background:#fff">x</body>`));
  }
  await expect.poll(async () => shell.evaluate(() => document.querySelectorAll('.tab').length), { timeout: 15_000 }).toBe(11);
  await shell.waitForTimeout(800);

  const prima = await shell.evaluate(() => {
    const el = [...document.querySelectorAll('.tab')].find((t) => !t.classList.contains('active'));
    const t = el.querySelector('.title');
    const r = el.getBoundingClientRect();
    return { nome: t.textContent, w: Math.round(r.width), titleW: Math.round(t.getBoundingClientRect().width),
      x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await shell.mouse.move(5, 5);
  await shell.mouse.move(prima.x, prima.y);
  await shell.waitForTimeout(400);
  const dopo = await shell.evaluate(() => {
    const el = document.querySelector('.tab:hover') || [...document.querySelectorAll('.tab')].find((t) => !t.classList.contains('active'));
    const t = el.querySelector('.title');
    const c = el.querySelector('.close');
    return { titleW: Math.round(t.getBoundingClientRect().width), closeW: c ? Math.round(c.getBoundingClientRect().width) : 0 };
  });
  console.log('hover scheda stretta:', JSON.stringify({ prima, dopo }));
  await shell.screenshot({ path: join(SHOTS, 'v429g12-hover-stretta.png'), clip: { x: 0, y: 0, width: 1280, height: 44 } });
  expect(dopo.titleW, `sotto il mouse al nome restano ${dopo.titleW}px (prima ${prima.titleW})`).toBeGreaterThan(20);
});

// 3. Il suggerimento dice lo STESSO nome che la scheda mostra?
test('il suggerimento di una pagina di Filo dice il nome della scheda', async ({ shell }) => {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://manage/manage.html'));
  await expect.poll(async () => shell.evaluate(() => document.querySelectorAll('.tab').length), { timeout: 12_000 }).toBe(2);
  await shell.waitForTimeout(1500);
  const v = await shell.evaluate(() => {
    const el = document.querySelector('.tab.active');
    return { etichetta: el.querySelector('.title').textContent, tip: el.dataset.tip };
  });
  console.log('etichetta/tip:', JSON.stringify(v));
  expect(v.tip, `la scheda dice "${v.etichetta}" ma il suggerimento dice "${v.tip}"`).toContain(v.etichetta);
});

// 4. Il tramonto si ripara appena tocchi le schede?
test('dopo il tramonto, cambiare scheda ripara i colori', async ({ shell, testServer }) => {
  await shell.emulateMedia({ colorScheme: 'light' });
  const fav = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="rgb(0,120,220)"/></svg>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(
    `<!doctype html><html><head><link rel="icon" href="data:image/svg+xml,${fav}"><title>Sito blu</title></head><body style="margin:0;background:#fff">x</body></html>`));
  await shell.waitForTimeout(1500);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html('<title>Davanti</title><body style="margin:0;background:rgb(250,250,250)">y</body>'));
  await expect.poll(async () => shell.evaluate(() => {
    const el = [...document.querySelectorAll('.tab')].find((t) => !t.classList.contains('active') && t.style.getPropertyValue('--tab-bg-eff'));
    return el ? el.style.getPropertyValue('--tab-bg-eff') : null;
  }), { timeout: 12_000 }).toMatch(/rgb/);

  await shell.emulateMedia({ colorScheme: 'dark' });
  await shell.waitForTimeout(3000);
  const stale = await shell.evaluate(() => {
    const el = [...document.querySelectorAll('.tab')].find((t) => !t.classList.contains('active') && t.style.getPropertyValue('--tab-bg-eff'));
    return getComputedStyle(el).backgroundColor;
  });
  // Tocca le schede: clic su un'altra scheda.
  await shell.evaluate(() => document.querySelector('.tab').click());
  await shell.waitForTimeout(2000);
  const dopo = await shell.evaluate(() => [...document.querySelectorAll('.tab')].map((el) => ({
    t: el.querySelector('.title').textContent, active: el.classList.contains('active'), bg: getComputedStyle(el).backgroundColor,
  })));
  console.log('tramonto — stale:', stale, 'dopo il clic:', JSON.stringify(dopo));
  await shell.screenshot({ path: join(SHOTS, 'v429g12-tramonto-riparato.png'), clip: { x: 0, y: 0, width: 900, height: 44 } });
});

// 5. Strada adiacente: pagina che dichiara theme-color colorato ma cima bianca.
test('cima bianca + marchio colorato: la scheda attiva resta la pagina, quella dietro prende il marchio', async ({ shell, testServer }) => {
  const fav = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="rgb(220,20,30)"/></svg>');
  const url = testServer.html(`<!doctype html><html><head><link rel="icon" href="data:image/svg+xml,${fav}"><title>Video rosso</title></head><body style="margin:0;background:#ffffff">x</body></html>`);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await shell.waitForTimeout(3000);
  const attiva = await shell.evaluate(() => getComputedStyle(document.querySelector('.tab.active')).backgroundColor);
  console.log('attiva su cima bianca + marchio rosso:', attiva);
  expect(attiva, 'la scheda attiva deve essere la cima della pagina, non il marchio').toBe('rgb(255, 255, 255)');

  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html('<title>Altra</title><body style="margin:0;background:rgb(30,30,40)">z</body>'));
  await shell.waitForTimeout(3000);
  const dietro = await shell.evaluate(() => {
    const el = [...document.querySelectorAll('.tab')].find((t) => t.querySelector('.title').textContent.includes('Video'));
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  console.log('dietro (marchio rosso):', dietro);
});

// 6. Una sola scheda: i piedini e la cucitura reggono anche lì.
test('una sola scheda: piedini dentro la striscia, niente scorrimento', async ({ shell }) => {
  await expect.poll(async () => shell.evaluate(() => document.querySelectorAll('.tab').length), { timeout: 10_000 }).toBe(1);
  const m = await shell.evaluate(() => {
    const s = document.querySelector('.tabs');
    const r = document.querySelector('.tab.active').getBoundingClientRect();
    const sr = s.getBoundingClientRect();
    s.scrollLeft = 9999; const scorsa = s.scrollLeft; s.scrollLeft = 0;
    return { scroll: s.scrollWidth, client: s.clientWidth, scorsa,
      sx: Math.round(r.left - sr.left), dx: Math.round(sr.right - r.right) };
  });
  expect(m.scroll, 'con una scheda la striscia non deve scorrere').toBeLessThanOrEqual(m.client);
  expect(m.scorsa).toBe(0);
  expect(m.sx, 'piedino sinistro').toBeGreaterThanOrEqual(8);
  expect(m.dx, 'piedino destro').toBeGreaterThanOrEqual(8);
});
