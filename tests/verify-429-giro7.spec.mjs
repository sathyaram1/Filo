// #429 — settima tornata: leggibilità delle schede NON attive sul tema scuro.

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
function contrasto(a, b) {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const rgb = (s) => {
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) return m[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(Number);
  const c = /color\(\s*srgb\s+([^)]+)\)/.exec(s);
  if (c) return c[1].trim().split(/[\s/]+/).slice(0, 3).map((v) => Math.round(parseFloat(v) * 255));
  return null;
};

const SCHEDE = () => [...document.querySelectorAll('.tab')].map((el) => {
  const t = el.querySelector('.title');
  return {
    text: t ? t.textContent : '',
    active: el.classList.contains('active'),
    bg: getComputedStyle(el).backgroundColor,
    fg: getComputedStyle(t || el).color,
    bgEff: el.style.getPropertyValue('--tab-bg-eff'),
  };
});

async function apri(shell, app, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const dl = Date.now() + 12000;
  while (Date.now() < dl) {
    const p = app.windows().find((w) => { try { return w.url().startsWith(url); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded').catch(() => {}); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('non aperta ' + url);
}

test.describe.configure({ mode: 'serial' });

for (const tema of ['light', 'dark']) {
  test(`#429/21 — leggibilità dei nomi nelle schede non attive (${tema})`, async ({ shell, app }) => {
    await shell.emulateMedia({ colorScheme: tema });
    const p = await apri(shell, app, 'filo://manage/manage.html');
    await p.emulateMedia({ colorScheme: tema });
    await shell.waitForTimeout(3000);
    const schede = await shell.evaluate(SCHEDE);
    for (const s of schede) {
      const a = rgb(s.bg), b = rgb(s.fg);
      if (!a || !b) { console.log(`[${tema}] colore non interpretabile: fondo ${s.bg} testo ${s.fg}`); continue; }
      const c = contrasto(a, b);
      console.log(`[${tema}] ${s.active ? 'ATTIVA ' : 'inattiva'} "${s.text}" fondo ${s.bg} testo ${s.fg} → contrasto ${c.toFixed(2)}:1   (tinta inline: ${s.bgEff || '—'})`);
    }
    await shell.screenshot({ path: join(SHOTS, `v429-leggibilita-${tema}.png`), clip: { x: 0, y: 0, width: 700, height: 44 } });
  });
}
