// Verifica #1127 giro 2: esplorazione dell'aspetto delle schede in coda (chiaro, scuro, hover).
import { test, expect, argomentiScala, chiudiApp, aspettaFinestra } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');
const ICONA = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#d33"/></svg>');

test('aspetto delle schede in coda', async () => {
  test.setTimeout(120_000);
  mkdirSync(SHOTS, { recursive: true });
  const server = createServer((req, res) => {
    const m = /^\/p\/(\d+)$/.exec(req.url);
    if (!m) { res.writeHead(404); res.end(); return; }
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>Pagina ${m[1]}</title><link rel="icon" href="data:image/svg+xml,${ICONA}"><h1>pagina ${m[1]}</h1>`);
    }, 4000);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const dati = cartellaTemporanea('filo-riap-g2-');
  const tabs = [...Array.from({ length: 6 }, (_, i) => `${origin}/p/${i}`), 'filo://history/', 'filo://options/'];
  writeFileSync(join(dati, 'storage.json'), JSON.stringify({
    filo_onboarding: { done: true },
    sn_open_tabs: { tabs, colors: tabs.map(() => null), activeIndex: 0 },
  }));
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: dati, NODE_ENV: 'test' } });
  try {
    const shell = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html'), 'shell');
    await expect(shell.locator('.tab')).toHaveCount(8, { timeout: 20_000 });
    await shell.waitForTimeout(1200);
    await shell.screenshot({ path: join(SHOTS, '1127-g2-coda-chiaro.png') });
    console.log('SNAP1', JSON.stringify(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.snapshot().tabs.map((t) => [t.title, t.loading, !!t.favicon]))));
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
    await shell.waitForTimeout(500);
    await shell.screenshot({ path: join(SHOTS, '1127-g2-coda-scuro.png') });
    await shell.locator('.tab').nth(5).hover();
    await shell.waitForTimeout(1500);
    await shell.screenshot({ path: join(SHOTS, '1127-g2-coda-hover.png') });
    await shell.waitForTimeout(16000);
    await shell.screenshot({ path: join(SHOTS, '1127-g2-fine.png') });
    console.log('SNAP2', JSON.stringify(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.snapshot().tabs.map((t) => [t.title, t.loading, !!t.favicon]))));
  } finally {
    await chiudiApp(app).catch(() => {});
    server.close();
    rmSync(dati, { recursive: true, force: true });
  }
});
