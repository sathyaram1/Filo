// #429 — ottava tornata: tema scuro VERO (nativeTheme del sistema), non
// emulazione del solo renderer. Leggibilità dei nomi nella striscia.

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

const SCHEDE = () => [...document.querySelectorAll('.tab')].map((el) => {
  const t = el.querySelector('.title');
  return { text: t ? t.textContent : '', active: el.classList.contains('active'),
    bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(t || el).color };
});

test('#429/22 — tema scuro di sistema: i nomi delle schede si leggono?', async ({ shell, app, testServer }) => {
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await shell.waitForTimeout(500);
  // una scheda interna di Filo + una scheda web colorata
  await shell.evaluate(() => window.filoShell.tabs.open('filo://manage/manage.html'));
  await shell.waitForTimeout(1500);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html('<title>Sito rosso</title><body style="margin:0;background:rgb(190,40,40)">x</body>'));
  await shell.waitForTimeout(3500);
  const schede = await shell.evaluate(SCHEDE);
  for (const s of schede) {
    const a = rgb(s.bg), b = rgb(s.fg);
    console.log(`${s.active ? 'ATTIVA ' : 'inattiva'} "${s.text}" fondo ${s.bg} testo ${s.fg} → contrasto ${a && b ? contrasto(a, b).toFixed(2) : '?'}:1`);
  }
  await shell.screenshot({ path: join(SHOTS, 'v429-scuro-sistema.png'), clip: { x: 0, y: 0, width: 1000, height: 44 } });
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'system'; });
});
