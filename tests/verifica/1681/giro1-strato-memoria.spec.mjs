// Verifica #1681 giro 1: #1096 sul cammino di un sito, dove il riquadro sta nello strato sopra la scheda, che resta
// vivo fra un'apertura e l'altra. Aperto dalla pagina come lo apre l'utente, chiuso dal suo tasto o con Esc.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, paginaDelloStrato } from '../../helpers/riquadri.mjs';

const PAGINA = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif"><p>Una pagina qualunque.</p></body></html>';

test('aperto e chiuso dieci volte su un sito, lo strato non tiene tele né ascoltatori in più', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const p = await testServer.openReady(openTab, PAGINA);
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  const strato = await paginaDelloStrato(app, p);
  await expect(strato.locator('.sn-fb-modal')).toBeVisible();
  await strato.locator('.sn-fb-cancel').click();
  await expect(strato.locator('.sn-fb-modal')).toHaveCount(0);

  const cdp = await strato.context().newCDPSession(strato);
  await cdp.send('Runtime.enable');
  const group = 'v1681';
  const oggetto = async (expr) => (await cdp.send('Runtime.evaluate', { expression: expr, objectGroup: group })).result.objectId;
  const misura = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: await oggetto('HTMLCanvasElement.prototype'), objectGroup: group });
    const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true, objectGroup: group });
    const asc = async (e) => (await cdp.send('DOMDebugger.getEventListeners', { objectId: await oggetto(e) })).listeners.length;
    const m = { tele: result.value, window: await asc('window'), documento: await asc('document'), viewport: await asc('visualViewport') };
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: group });
    return m;
  };
  const giri = async (n) => { for (let i = 0; i < n; i++) {
    await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
    await expect(strato.locator('.sn-fb-modal')).toBeVisible();
    await strato.locator('.sn-fb-text').fill(`giro ${i}`);
    const box = await strato.locator('.sn-fb-canvas').boundingBox();
    await strato.mouse.move(box.x + 30, box.y + 30);
    await strato.mouse.down();
    await strato.mouse.move(box.x + 120, box.y + 60);
    await strato.mouse.up();
    if (i % 2) await strato.locator('.sn-fb-cancel').click();
    else await strato.keyboard.press('Escape');
    await expect(strato.locator('.sn-fb-modal')).toHaveCount(0);
  } };
  await giri(4);
  const prima = await misura();
  await giri(10);
  const dopo = await misura();
  expect({ ...dopo, tele: 0 }).toEqual({ ...prima, tele: 0 });
  expect(dopo.tele - prima.tele).toBeLessThanOrEqual(1);
});
