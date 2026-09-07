// #429 — nona tornata: sul tema scuro una scheda NON attiva di un sito dal
// marchio chiaro (Wikipedia, GitHub, X… o le pagine di Filo) diventa un
// rettangolo chiaro col nome scritto in un grigio quasi identico.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

function lum([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrasto = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const rgb = (s) => {
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) return m[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(Number);
  const c = /color\(\s*srgb\s+([^)]+)\)/.exec(s);
  if (c) return c[1].trim().split(/[\s/]+/).slice(0, 3).map((v) => Math.round(parseFloat(v) * 255));
  return null;
};

test('#429/23 — tema scuro: nomi delle schede non attive (sito dal marchio chiaro)', async ({ shell, testServer }) => {
  await shell.emulateMedia({ colorScheme: 'dark' });
  const fav = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="rgb(240,240,240)"/></svg>');
  const bianco = `<!doctype html><html><head><link rel="icon" href="data:image/svg+xml,${fav}"><title>Enciclopedia libera</title></head><body style="margin:0;background:#fff">testo</body></html>`;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(bianco));
  await shell.waitForTimeout(1500);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html('<title>Scheda in primo piano</title><body style="margin:0;background:rgb(20,20,20)">y</body>'));
  await shell.waitForTimeout(3500);
  const schede = await shell.evaluate(() => [...document.querySelectorAll('.tab')].map((el) => {
    const t = el.querySelector('.title');
    return { text: t ? t.textContent : '', active: el.classList.contains('active'),
      bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(t || el).color };
  }));
  for (const s of schede) {
    const a = rgb(s.bg), b = rgb(s.fg);
    console.log(`${s.active ? 'ATTIVA ' : 'inattiva'} "${s.text}" fondo ${s.bg} testo ${s.fg} → contrasto ${a && b ? contrasto(a, b).toFixed(2) : '?'}:1`);
  }
  await shell.screenshot({ path: join(SHOTS, 'v429-scuro-marchio-chiaro.png'), clip: { x: 0, y: 0, width: 1000, height: 44 } });
});
