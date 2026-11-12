// #1623.3 giro 1 — esplorazione: un'immagine data al riquadro delle segnalazioni aperto su un sito (rilascio o incolla)
// entra fra gli allegati, e il sito non la vede passare.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { nelMondoDiFilo, nelloStrato, statoDi, paginaDelloStrato, clicca } from '../../helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const SPIA = `<script>
  window.visti = [];
  for (const t of ['dragenter', 'dragover', 'drop', 'paste']) {
    window.addEventListener(t, (e) => {
      const dt = e.dataTransfer || e.clipboardData;
      const files = dt ? Array.from(dt.files || []).map((f) => f.name || f.type) : [];
      window.visti.push(t + ':' + files.join(','));
      if (t !== 'paste') e.preventDefault();
    }, true);
  }
</script>`;
const pagina = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">`
  + `<p>Carica qui le tue foto.</p><div style="height:1500px"></div>${SPIA}</body></html>`;

const allegati = (app, p) => nelloStrato(app, p, () => document.querySelectorAll('.sn-fb-thumbs > *').length);

test('feedback su un sito: rilascio e incolla di una foto entrano negli allegati e il sito non vede niente', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, pagina);
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, p, '.sn-fb-modal')).not.toBeNull();
  const box = await statoDi(app, p, '.sn-fb-modal');
  expect(box.nelloStrato).toBe(true);

  // Lo strato è in cima alla finestra e copre il riquadro: un rilascio del sistema sopra il riquadro cade lì.
  const posa = await app.evaluate(({ BrowserWindow }, u) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    const tab = tm.tabs.find((t) => t.view.webContents.getURL() === u);
    const s = tm.riquadri.strati.get(tab.view.webContents);
    const figli = win.contentView.children;
    const iCornice = figli.indexOf(s.cornice);
    const iScheda = figli.indexOf(tab.view);
    return { visibile: s.visibile, modale: s.modale, iCornice, iScheda, cornice: s.cornice.getBounds(), vista: s.vista.getBounds(), scheda: tab.view.getBounds() };
  }, p.url());
  expect(posa.visibile).toBe(true);
  expect(posa.modale).toBe(true);
  expect(posa.iCornice).toBeGreaterThan(posa.iScheda);
  const cx = posa.scheda.x + box.x + box.width / 2;
  const cy = posa.scheda.y + box.y + box.height / 2;
  expect(cx >= posa.cornice.x && cx <= posa.cornice.x + posa.cornice.width).toBe(true);
  expect(cy >= posa.cornice.y && cy <= posa.cornice.y + posa.cornice.height).toBe(true);

  // Rilascio vero (DevTools) sul riquadro nello strato.
  const strato = await paginaDelloStrato(app, p);
  const foto = join(cartellaInCasa('filo-verifica-1623-'), 'estratto conto.png');
  writeFileSync(foto, PNG);
  const s = await strato.context().newCDPSession(strato);
  const data = { items: [], files: [foto], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x: box.x + box.width / 2, y: box.y + box.height / 2, data });
  await s.detach().catch(() => {});
  await expect.poll(() => allegati(app, p), { timeout: 8_000 }).toBe(1);

  // Incolla con la tastiera, dove la tastiera sta davvero.
  await app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' }) })]);
  }, PNG.toString('base64'));
  await clicca(app, p, '.sn-fb-text');
  const chi = await app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL() || '');
  expect(chi.startsWith('filo://riquadri/')).toBe(true);
  await strato.keyboard.press('Control+V');
  await expect.poll(() => allegati(app, p), { timeout: 8_000 }).toBe(2);

  await p.waitForTimeout(400);
  expect(await p.evaluate(() => window.visti)).toEqual([]);
});
