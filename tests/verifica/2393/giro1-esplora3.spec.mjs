// Esplorazione: collegamento a una pagina già aperta in un'altra scheda, lasciato fra due schede.

import { test, expect } from '../../fixtures/electron.mjs';
import * as Gesti from '../../helpers/gestiVeri.mjs';

const snap = (shell) => shell.evaluate(() => window.filoShell.tabs.snapshot());

test('link a una pagina già aperta, sul bordo fra due schede', async ({ app, shell, openTab, testServer }) => {
  test.skip(!Gesti.disponibili(), 'gesti');
  const giaAperta = testServer.html('<title>Video già aperto</title><p>v');
  await openTab(giaAperta);
  await openTab(testServer.html('<title>Due</title><p>due'));
  const sorgente = await openTab(testServer.html(`<title>S</title><body style="margin:0"><a id="l" href="${giaAperta}" style="position:absolute;left:300px;top:300px;font-size:30px">video</a>`));
  await Gesti.finestraASchermo(app);
  const prima = await snap(shell);
  const da = await Gesti.sulloSchermo(app, sorgente, sorgente, '#l');
  const r = await shell.evaluate(() => { const a = document.querySelectorAll('.tab')[2].getBoundingClientRect(); const b = document.querySelectorAll('.tab')[3].getBoundingClientRect(); return { x: (a.right + b.left) / 2, y: a.top + a.height / 2 }; });
  const o = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito); const cb = w.getContentBounds(); return { x: cb.x, y: cb.y, z: w.webContents.getZoomFactor() || 1 }; });
  Gesti.trascina(da, { x: Math.round(o.x + r.x * o.z), y: Math.round(o.y + r.y * o.z) });
  await new Promise((res) => setTimeout(res, 2000));
  const dopo = await snap(shell);
  console.log('prima', JSON.stringify(prima.tabs.map((t) => t.url)));
  console.log('dopo ', JSON.stringify(dopo.tabs.map((t) => t.url)), 'attiva', dopo.tabs.findIndex((t) => t.id === dopo.activeId));
});
