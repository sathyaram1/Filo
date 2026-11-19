// Verifica #2393 giro 1, rilievo 1: un indirizzo scritto in chiaro nella pagina (non un collegamento), selezionato e
// trascinato col mouse vero sul centro di una scheda, si apre lì come in Chrome.

import { test, expect } from '../../fixtures/electron.mjs';
import * as Gesti from '../../helpers/gestiVeri.mjs';

const snap = (shell) => shell.evaluate(() => window.filoShell.tabs.snapshot());

test('r1 un indirizzo selezionato nel testo e lasciato sul centro di una scheda la porta lì', async ({ app, shell, openTab, testServer }) => {
  test.skip(!Gesti.disponibili(), 'servono un display X e XTest (lo schermo virtuale delle prove su Linux)');
  const destinazione = testServer.html('<title>Video arrivato</title><p>ok');
  await openTab(testServer.html('<title>Uno</title><p>uno'));
  const sorgente = await testServer.openReady(openTab, `<title>Commento</title><body style="margin:0">
    <p id="testo" style="position:absolute;left:300px;top:300px;font-size:24px">${destinazione}</p></body>`);
  await Gesti.finestraASchermo(app);
  const prima = await snap(shell);
  const bersaglio = prima.tabs[1].id;
  await sorgente.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('testo'));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  const da = await Gesti.sulloSchermo(app, sorgente, sorgente, '#testo');
  const r = await shell.evaluate((id) => {
    const b = document.querySelector(`.tab[data-id="${id}"]`).getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, bersaglio);
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const cb = w.getContentBounds();
    return { x: cb.x, y: cb.y, z: w.webContents.getZoomFactor() || 1 };
  });
  Gesti.trascina(da, { x: Math.round(o.x + r.x * o.z), y: Math.round(o.y + r.y * o.z) });
  await expect.poll(async () => (await snap(shell)).tabs.find((t) => t.id === bersaglio)?.url, { timeout: 8000 }).toBe(destinazione);
  expect((await snap(shell)).activeId).toBe(bersaglio);
});
