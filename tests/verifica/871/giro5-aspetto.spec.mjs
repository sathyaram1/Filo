// #871 giro 5 — esplorazione: la barra guardata davvero (schermata dello schermo virtuale), chiaro e scuro.

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = resolve(APP_ROOT, 'tests', '.shots', 'v871g5');
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const SITO = `<!doctype html><html><body style="margin:0;font:16px sans-serif;background:#fff">
<nav style="position:fixed;left:0;top:0;width:220px;height:100%;background:#1f2a44;color:#fff;padding:12px">Menu sito<br>Voce 1<br>Voce 2</nav>
<main style="margin-left:240px;padding:20px"><h1>Pagina di prova</h1><p>Testo lungo di prova.</p></main></body></html>`;

test('schermate della barra', async () => {
  test.setTimeout(120_000);
  mkdirSync(OUT, { recursive: true });
  const scala = process.env.FILO_TEST_SCALE || '1';
  const userData = cartellaTemporanea('filo-v871-');
  const server = createServer((_q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(SITO); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/sito`;
  const env = { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', FILO_TEST_VISIBLE: '1' };
  delete env.FILO_HIDE_WINDOW;
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setBounds({ x: 0, y: 0, width: 1200, height: 760 }));
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    await pausa(2500);
    const barra = await barraPage(app);
    const foto = (nome) => execFileSync('scrot', ['-o', resolve(OUT, `${nome}-s${scala}.png`)], { env: process.env });
    foto('sito-chiusa');
    await comandaBarra(app, 'tasto');
    await pannelloFermo(barra);
    await barra.hover('#nav .ico[data-id="back"]').catch(() => {});
    await pausa(700);
    foto('sito-aperta-chiaro');
    await app.evaluate(async () => globalThis.__filoHandlers.handleMessage(
      { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } },
      { url: 'filo://preferences/preferences.html' },
    ));
    await pausa(1200);
    foto('sito-aperta-scuro');
    await comandaBarra(app, 'chiudi');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    await pausa(2500);
    foto('home-chiusa-scuro');
    await comandaBarra(app, 'tasto');
    await pannelloFermo(barra);
    await pausa(500);
    foto('home-aperta-scuro');
    await comandaBarra(app, 'chiudi');
    await app.evaluate(async () => globalThis.__filoHandlers.handleMessage(
      { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'light' } },
      { url: 'filo://preferences/preferences.html' },
    ));
    await pausa(1200);
    foto('home-chiusa-chiaro');
    await comandaBarra(app, 'tasto');
    await pannelloFermo(barra);
    await pausa(500);
    foto('home-aperta-chiaro');
    console.log('stato', JSON.stringify(await statoBarra(app)));
  } finally {
    await chiudiApp(app);
    server.close();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
