// Esplorazione del giro 9 (#871): si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'tests/.shots/g9';
mkdirSync(OUT, { recursive: true });
const scatta = (nome) => { try { execFileSync('scrot', ['-o', `${OUT}/${nome}.png`]); } catch (e) { console.log('scrot', e.message); } };

const SITO = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
  <div style="display:flex"><nav style="width:220px;background:#eee;height:900px;padding:10px">Colonna<br><a href="#">uno</a><br><a href="#">due</a></nav>
  <main style="padding:20px"><h1>Pagina di prova</h1><p>Testo.</p></main></div></body></html>`;

test('aspetto: sito e home, chiaro e scuro', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.maximize(); });
  await pausa(800);
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await pausa(500);
  scatta('sito-chiusa-chiaro');
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  scatta('sito-aperta-chiaro');
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await pausa(1200);
  scatta('sito-aperta-scuro');
  await comandaBarra(app, 'chiudi');
  await pausa(500);
  scatta('sito-chiusa-scuro');
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.navigate(w._filoTabs.activeId, 'filo://newtab/');
  });
  await pausa(2500);
  scatta('home-chiusa-scuro');
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  scatta('home-aperta-scuro');
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'light' } }));
  await pausa(1200);
  scatta('home-aperta-chiaro');
  await comandaBarra(app, 'chiudi');
  await pausa(500);
  scatta('home-chiusa-chiaro');
  const s = await statoBarra(app);
  console.log(JSON.stringify(s));
});
