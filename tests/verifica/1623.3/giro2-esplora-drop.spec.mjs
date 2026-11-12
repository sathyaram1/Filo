// Esplorazione verifica #1623.3 giro 2: un documento sul box e un file lasciato fuori dal box, sul velo.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { statoDi, conta, scrivi, paginaDelloStrato } from '../../helpers/riquadri.mjs';

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif;height:700px">`
  + `<p>Pagina che ascolta.</p><script>window.__file=[];`
  + `for (const t of ['dragenter','dragover','drop']) window.addEventListener(t,(e)=>{for (const f of (e.dataTransfer&&e.dataTransfer.files)||[]) window.__file.push(t+' '+f.name); if (t==='drop') window.__file.push('drop');},true);`
  + `</script></body></html>`;

async function lascia(app, p, file, punto) {
  const strato = await paginaDelloStrato(app, p);
  const s = await strato.context().newCDPSession(strato);
  const data = { items: [], files: [file], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, ...punto, data });
  await s.detach().catch(() => {});
  return strato;
}

test('documento sul box e file sul velo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const dir = cartellaInCasa('filo-test-1623-3-g2-');
  const doc = join(dir, 'estratto conto.pdf');
  writeFileSync(doc, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const txt = join(dir, 'note segrete.txt');
  writeFileSync(txt, 'conto 12345');
  const p = await testServer.openReady(openTab, PAGINA);
  await app.evaluate(async ({ BrowserWindow }, u) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win.show(); win.focus();
    win._filoTabs.tabs.find((t) => t.view.webContents.getURL() === u).view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: 'globalThis.SN_FEEDBACK_UI.open()' }]);
  }, p.url());
  await expect.poll(() => statoDi(app, p, '.sn-fb-modal')).not.toBeNull();
  const box = await statoDi(app, p, '.sn-fb-modal');
  await scrivi(app, p, '.sn-fb-text', 'bozza da non perdere');
  const strato = await lascia(app, p, doc, { x: box.x + box.width / 2, y: box.y + box.height / 3 });
  await expect.poll(() => conta(app, p, '.sn-fb-file-chip'), { timeout: 8_000 }).toBe(1);
  const urlPrima = strato.url();
  const fuori = { x: Math.max(5, box.x - 30), y: Math.max(5, box.y - 30) };
  console.log('box', JSON.stringify(box), 'fuori', JSON.stringify(fuori));
  await lascia(app, p, txt, fuori);
  await p.waitForTimeout(1500);
  const visti = await p.evaluate(() => window.__file);
  const dopo = { url: strato.isClosed() ? 'chiusa' : strato.url(), chip: await conta(app, p, '.sn-fb-file-chip'), testo: (await statoDi(app, p, '.sn-fb-text'))?.valore };
  console.log('VELO sito:', JSON.stringify(visti), 'prima', urlPrima, 'dopo', JSON.stringify(dopo));
  expect(visti).toEqual([]);
  expect(dopo.testo).toBe('bozza da non perdere');
  expect(dopo.url).toBe(urlPrima);
});
