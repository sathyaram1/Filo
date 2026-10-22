// Esplorazione verifica #1343 giro 6: le altre azioni della barra sul PDF. Si cancella.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { iconaDellaBarra } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const naviga = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.navigate(w._filoTabs.activeId, url);
}, u);

for (const pdf of [false, true]) {
  test(`esplora screenshot e qr pdf=${pdf}`, async ({ app, openTab, testServer }) => {
    await testServer.openReady(openTab, '<!doctype html><title>Prima</title><body style="background:#fff"><h1>Prima</h1></body>');
    if (pdf) { await naviga(app, testServer.asset(readFileSync('tests/fixtures/documenti/documento-con-testo.pdf'), 'application/pdf')); await pausa(2500); }
    await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
    await (await iconaDellaBarra(app, 'screenshot')).click();
    await pausa(4000);
    const img = await app.evaluate(({ clipboard }) => { const i = clipboard.readImage(); return i.isEmpty() ? 0 : i.getSize().width; });
    console.log(`ESPLORA pdf=${pdf} screenshot immagine larga ${img}`);
    await (await iconaDellaBarra(app, 'qrCode')).click();
    await pausa(2000);
    const cap = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
      return (await t.view.webContents.capturePage()).toPNG().toString('base64');
    });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`/tmp/claude-0/-home-user-Filo/dfa679fd-76b6-5ef1-9437-3face45b0ee2/scratchpad/qr-pdf-${pdf}.png`, Buffer.from(cap, 'base64'));
    expect(true).toBe(true);
  });
}
