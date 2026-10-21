import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } });
});
const notifiche = (shell) => shell.evaluate(() => [...document.querySelectorAll('#shell-notifs > .shell-notif')]
  .filter((c) => c.dataset.closing !== '1').map((c) => c.textContent.trim()));
const homeDiFilo = async (app, shell) => {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  let home = null;
  await expect.poll(() => { home = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(home); }).toBe(true);
  await home.waitForFunction(() => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage);
  return home;
};
const azione = (home, a) => home.evaluate((x) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: x }), a);

test('esplora assistente NAVIGA', async ({ app, shell, testServer }) => {
  test.setTimeout(180_000);
  await app.evaluate(({ shell: s }) => { globalThis.__esterni = []; s.openExternal = async (u) => { globalThis.__esterni.push(String(u)); }; });
  const home = await homeDiFilo(app, shell);
  const port = new URL(testServer.origin).port;
  for (const u of ['./conto.pdf', 'conto.pdf', 'D:', '/data/progetti', 'MAILTO:mario@esempio.it', 'mario.rossi@esempio.it.',
    `127.0.0.1:${port}/x`, 'nas.lan:5000', `localhost:${port}`, '“/run/media/u/USB/x.pdf”', 'file:C:\\x.pdf', 'tel:+39021234']) {
    const prima = await schede(app);
    const r = await azione(home, { type: 'NAVIGA', url: u });
    await shell.waitForTimeout(1500);
    const dopo = (await schede(app)).filter((x) => !prima.includes(x));
    console.log(`[NAVIGA ${u}]`, JSON.stringify({ executed: r && r.executed, out: r && r.output, nuove: dopo, esterni: await app.evaluate(() => globalThis.__esterni.splice(0)) }));
  }
  console.log('[notifiche]', JSON.stringify(await notifiche(shell)));
});

test('esplora assistente LEGGI_DOCUMENTO e LEGGI_PAGINA', async ({ app, shell }) => {
  test.setTimeout(180_000);
  const dir = join(cartellaTemporanea(), `filo-1318-${Date.now()}`, 'una cartella');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'nota prova.txt');
  writeFileSync(f, 'contenuto segreto della nota');
  const home = await homeDiFilo(app, shell);
  const furl = 'file://' + f.split('/').map(encodeURIComponent).join('/');
  for (const p of [f, `"${f}"`, `«${f}»`, `\`${f}\``, `'${f}'`, `“${f}”`, `"${f}".`, furl, `"${furl}"`, 'file://' + f, `<${f}>`]) {
    const r = await azione(home, { type: 'LEGGI_DOCUMENTO', percorso: p });
    console.log(`[LEGGI_DOCUMENTO ${p}]`, JSON.stringify(r).slice(0, 300));
  }
  for (const p of [f, '/run/media/u/USB/x.pdf', '"C:\\Users\\x\\y.pdf"']) {
    const r = await azione(home, { type: 'LEGGI_PAGINA', url: p });
    console.log(`[LEGGI_PAGINA ${p}]`, JSON.stringify(r).slice(0, 300));
  }
  console.log('[schede]', JSON.stringify(await schede(app)));
});
