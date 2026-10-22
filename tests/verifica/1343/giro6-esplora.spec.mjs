// Esplorazione verifica #1343 giro 6: perché Condividi dalla barra non copia sul PDF. Si cancella.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { iconaDellaBarra } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const naviga = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.navigate(w._filoTabs.activeId, url);
}, u);

test('esplora pdf', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<!doctype html><title>Prima</title><h1>Prima</h1>');
  const pdf = testServer.asset(readFileSync('tests/fixtures/documenti/documento-con-testo.pdf'), 'application/pdf');
  await naviga(app, pdf);
  await pausa(3000);
  await app.evaluate(({ BrowserWindow, clipboard }) => {
    clipboard.writeText('niente');
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    global.__cons = [];
    t.view.webContents.on('console-message', (e) => global.__cons.push(String(e.message || e).slice(0, 300)));
  });
  const share = await iconaDellaBarra(app, 'share');
  await share.click();
  await pausa(2500);
  const r = await app.evaluate(({ BrowserWindow, clipboard }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return { clip: clipboard.readText(), cons: global.__cons, frames: t.view.webContents.mainFrame.framesInSubtree.map((f) => f.url) };
  });
  console.log('ESPLORA', JSON.stringify(r));
  const pg = app.windows().find((w) => { try { return w.url().endsWith('/a2') || w.url().includes('.pdf'); } catch (_) { return false; } });
  if (pg) console.log('ESPLORA doc', JSON.stringify(await pg.evaluate(() => ({ focus: document.hasFocus(), act: document.activeElement && document.activeElement.tagName, share: typeof navigator.share, sn: !!globalThis.SN_MENU_ICONS }))));
  expect(true).toBe(true);
});
