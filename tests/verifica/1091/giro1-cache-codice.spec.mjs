// #1091 giro 1 — dopo qualche apertura delle pagine interne, la cache del codice del profilo contiene i loro script.
import { test, expect, _electron as electron } from '@playwright/test';
import { readdirSync, readFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
test.setTimeout(180_000);

function vociFilo(userData) {
  const dir = join(userData, 'Code Cache', 'js');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    let buf; try { if (!statSync(p).isFile()) continue; buf = readFileSync(p); } catch (_) { continue; }
    const s = buf.toString('latin1');
    const m = s.match(/filo:\/\/[\x21-\x7e]+?\.m?js/);
    if (m) out.push({ url: m[0], size: buf.length });
  }
  return out;
}

async function apriERicarica(app, shell, url, volte) {
  const host = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const scad = Date.now() + 15_000;
  let page = null;
  while (Date.now() < scad && !page) {
    page = app.windows().find((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } });
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  expect(page, url).toBeTruthy();
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(1500);
  for (let i = 1; i < volte; i++) {
    await page.reload({ waitUntil: 'load' }).catch(() => {});
    await page.waitForTimeout(1500);
  }
}

test('le pagine interne riaperte lasciano i loro script nella cache del codice', async () => {
  const userData = cartellaTemporanea('filo-1091-');
  const avvia = () => electron.launch({
    args: [...argomentiScala, '.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    for (let giro = 0; giro < 2; giro++) {
      const app = await avvia();
      const shell = await app.firstWindow();
      await shell.waitForLoadState('domcontentloaded');
      await apriERicarica(app, shell, 'filo://newtab/', 2);
      await apriERicarica(app, shell, 'filo://preferences/', 2);
      await new Promise((r) => setTimeout(r, 3000));
      await chiudiApp(app, { tetto: 10_000 });
    }
    const voci = vociFilo(userData);
    console.log(JSON.stringify(voci.sort((a, b) => b.size - a.size).slice(0, 40), null, 1));
    console.log('voci filo:', voci.length, 'con codice (>4KB):', voci.filter((v) => v.size > 4096).length);
    expect(voci.length).toBeGreaterThan(0);
    expect(voci.filter((v) => v.size > 4096).length).toBeGreaterThan(0);
  } finally {
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
