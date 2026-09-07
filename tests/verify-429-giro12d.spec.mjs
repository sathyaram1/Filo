// Verifica avversariale #429 — quarto blocco: conta le porte.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

const favDi = (col) => encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${col}"/></svg>`);

// Porte del "la scheda attiva non è più la pagina": cima neutra di ogni tipo.
for (const [nome, fondo, marchio] of [
  ['cima bianca', '#ffffff', 'rgb(220,20,20)'],
  ['cima quasi nera', 'rgb(18,18,20)', 'rgb(255,140,0)'],
  ['cima grigio chiaro', 'rgb(238,238,238)', 'rgb(20,160,90)'],
  ['cima blu scuro poco satura (stile negozio)', 'rgb(19,25,33)', 'rgb(255,153,0)'],
]) {
  test(`[porta] ${nome} + marchio colorato: la scheda in primo piano segue la pagina?`, async ({ shell, testServer }) => {
    const url = testServer.html(
      `<!doctype html><html><head><link rel="icon" href="data:image/svg+xml,${favDi(marchio)}">`
      + `<title>${nome}</title></head><body style="margin:0;background:${fondo}">`
      + '<div style="height:1200px"></div></body></html>');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    await shell.waitForTimeout(4000);
    const v = await shell.evaluate(() => {
      const el = document.querySelector('.tab.active');
      return { bg: getComputedStyle(el).backgroundColor, testo: getComputedStyle(el.querySelector('.title')).color };
    });
    console.log(`PORTA "${nome}": pagina ${fondo} → scheda ${v.bg} (nome ${v.testo})`);
  });
}

// Il tramonto al contrario: dal buio alla luce.
test('[porta] dal tema scuro a quello chiaro: le schede dietro restano scure sulla barra chiara?', async ({ shell, testServer }) => {
  await shell.emulateMedia({ colorScheme: 'dark' });
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(
    `<!doctype html><html><head><link rel="icon" href="data:image/svg+xml,${favDi('rgb(0,120,220)')}"><title>Sito blu</title></head><body style="margin:0;background:rgb(15,15,18)">x</body></html>`));
  await shell.waitForTimeout(1800);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html('<title>Davanti</title><body style="margin:0;background:rgb(15,15,18)">y</body>'));
  await expect.poll(async () => shell.evaluate(() => {
    const el = [...document.querySelectorAll('.tab')].find((t) => !t.classList.contains('active') && t.style.getPropertyValue('--tab-bg-eff'));
    return el ? el.style.getPropertyValue('--tab-bg-eff') : null;
  }), { timeout: 12_000 }).toMatch(/rgb/);
  await shell.emulateMedia({ colorScheme: 'light' });
  await shell.waitForTimeout(3500);
  const v = await shell.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.cssText = 'display:none;background:var(--tab-bg)';
    document.body.appendChild(probe);
    const barra = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { barra, schede: [...document.querySelectorAll('.tab')].map((el) => ({ t: el.querySelector('.title').textContent, active: el.classList.contains('active'), bg: getComputedStyle(el).backgroundColor })) };
  });
  console.log('alba:', JSON.stringify(v));
  await shell.screenshot({ path: join(SHOTS, 'v429g12-alba.png'), clip: { x: 0, y: 0, width: 900, height: 44 } });
});

// Quanti pixel restano al nome sotto il mouse, con 14 schede su una finestra piena.
test('[porta] 14 schede su 1280px: il nome sotto il mouse', async ({ shell, testServer }) => {
  for (let i = 1; i <= 13; i++) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>Notiziario ${i}</title><body style="margin:0;background:#fff">x</body>`));
  }
  await expect.poll(async () => shell.evaluate(() => document.querySelectorAll('.tab').length), { timeout: 20_000 }).toBe(14);
  await shell.waitForTimeout(1000);
  const p = await shell.evaluate(() => {
    const el = [...document.querySelectorAll('.tab')].filter((t) => !t.classList.contains('active'))[4];
    const t = el.querySelector('.title'); const r = el.getBoundingClientRect();
    return { nome: t.textContent, w: Math.round(r.width), titleW: Math.round(t.getBoundingClientRect().width), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await shell.mouse.move(3, 3);
  await shell.mouse.move(p.x, p.y);
  await shell.waitForTimeout(500);
  const d = await shell.evaluate(() => {
    const el = document.querySelector('.tab:hover');
    if (!el) return null;
    const t = el.querySelector('.title');
    return { titleW: Math.round(t.getBoundingClientRect().width) };
  });
  console.log('14 schede — prima:', JSON.stringify(p), 'sotto il mouse:', JSON.stringify(d));
  await shell.screenshot({ path: join(SHOTS, 'v429g12-14-hover.png'), clip: { x: 0, y: 0, width: 1280, height: 44 } });
});
