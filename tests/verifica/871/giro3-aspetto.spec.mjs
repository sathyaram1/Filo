// #871 giro 3 — esplorazione dell'aspetto: la finestra vera sullo schermo virtuale, fotografata con scrot.

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const scala = process.env.FILO_TEST_SCALE || '1';

const SITO = `<!doctype html><html><body style="margin:0;font:16px sans-serif;height:1400px;display:flex">
  <nav style="width:200px;background:#eef;padding:12px">Colonna sinistra<br><a href="#">Link uno</a><br><a href="#">Link due</a></nav>
  <main style="padding:24px"><h1>Una pagina qualunque</h1><p id="p">Testo.</p></main></body></html>`;

const foto = (nome) => { try { execFileSync('scrot', ['-o', `tests/.shots/g3-${nome}-s${scala}.png`], { cwd: APP_ROOT, env: process.env }); } catch (e) { console.log('scrot', String(e)); } };

test('aspetto della barra: sito e home, chiaro e scuro', async () => {
  test.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-barra-g3a-');
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(SITO); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/sito`;
  const env = { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', FILO_TEST_VISIBLE: '1' };
  delete env.FILO_HIDE_WINDOW;
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env, colorScheme: null });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setBounds({ x: 0, y: 0, width: 1200, height: 760 }));
    await pausa(1500);
    const barra = await barraPage(app);
    foto('home-chiusa-chiaro');
    await comandaBarra(app, 'clic');
    await pannelloFermo(barra);
    foto('home-aperta-chiaro');
    await comandaBarra(app, 'chiudi');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    await expect.poll(async () => app.windows().some((w) => { try { return w.url() === url; } catch (_) { return false; } })).toBe(true);
    await pausa(1200);
    foto('sito-chiusa-chiaro');
    await comandaBarra(app, 'clic');
    await pannelloFermo(barra);
    foto('sito-aperta-chiaro');
    await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { theme: 'dark' } }, { url: 'filo://preferences/preferences.html' }));
    await pausa(1200);
    console.log('nativeTheme', await app.evaluate(({ nativeTheme }) => ({ src: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors })));
    console.log('shell dark?', await shell.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), 'barra dark?', await barra.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches));
    console.log('shell bg', await shell.evaluate(() => getComputedStyle(document.body).backgroundColor), 'pannello bg', await barra.evaluate(() => getComputedStyle(document.getElementById('pannello')).backgroundColor));
    foto('sito-aperta-scuro');
    await comandaBarra(app, 'chiudi');
    await pausa(500);
    foto('sito-chiusa-scuro');
    await shell.evaluate(() => { const t = document.querySelectorAll('.tab'); t[0].click(); });
    await pausa(1000);
    foto('home-chiusa-scuro');
    await comandaBarra(app, 'clic');
    await pannelloFermo(barra);
    foto('home-aperta-scuro');
    console.log(JSON.stringify(await statoBarra(app)));
  } finally {
    await chiudiApp(app);
    try { server.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
