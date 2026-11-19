// Verifica #1664 giro 1, esplorazione: il riquadro della segnalazione con una foto grande, un AVIF e il selettore.

import { readFileSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';

const TETTO = 4 * 1024 * 1024;

async function riquadro(app) {
  let win = null;
  await expect.poll(() => {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    return !!win;
  }, { timeout: 10_000 }).toBe(true);
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await win.evaluate(() => {
    window.__inviati = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'submit_feedback') {
        window.__inviati.push(msg.payload);
        return Promise.resolve({ ok: true, id: 'test-fb' });
      }
      return orig(msg, ...rest);
    };
  });
  await win.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(win.locator('.sn-fb-modal')).toBeVisible();
  return win;
}

async function lascia(win, crea) {
  await win.evaluate(async (crea) => {
    // eslint-disable-next-line no-new-func
    const file = await (new Function(`return (${crea})`)())();
    const dt = new DataTransfer();
    dt.items.add(file);
    document.querySelector('.sn-fb-modal').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, crea.toString());
}

test('foto di rumore oltre i 4 MB lasciata nel riquadro: entra e parte sotto il tetto', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const win = await riquadro(app);
  const grande = await win.evaluate(async () => {
    const c = new OffscreenCanvas(3000, 2400);
    const g = c.getContext('2d');
    const d = g.createImageData(3000, 2400);
    for (let i = 0; i < d.data.length; i++) d.data[i] = (i % 4 === 3) ? 255 : Math.floor(Math.random() * 256);
    g.putImageData(d, 0, 0);
    const b = await c.convertToBlob({ type: 'image/jpeg', quality: 0.97 });
    window.__grande = new File([b], 'IMG_0001.JPG', { type: 'image/jpeg' });
    return b.size;
  });
  expect(grande).toBeGreaterThan(TETTO);
  await win.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(window.__grande);
    document.querySelector('.sn-fb-modal').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(win.locator('.sn-fb-thumb img')).toHaveCount(1, { timeout: 20_000 });
  await win.locator('.sn-fb-text').fill('foto grande');
  await win.locator('.sn-fb-send').click();
  await expect.poll(() => win.evaluate(() => window.__inviati.length), { timeout: 20_000 }).toBe(1);
  const p = await win.evaluate(() => window.__inviati[0]);
  expect(p.images.length).toBeGreaterThanOrEqual(1);
  const u = p.images.find((x) => x && /IMG_0001/.test(x.name || '')) || p.images[p.images.length - 1];
  expect(Math.floor((u.dataUrl.length - u.dataUrl.indexOf(',') - 1) * 3 / 4)).toBeLessThanOrEqual(TETTO);
});

test('AVIF lasciato nel riquadro entra; il selettore lo propone', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const win = await riquadro(app);
  const avif = readFileSync('tests/fixtures/provenienza/xmp-ai.avif').toString('base64');
  await win.evaluate((b64) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([u], 'foto.avif', { type: 'image/avif' }));
    document.querySelector('.sn-fb-modal').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, avif);
  await expect(win.locator('.sn-fb-thumb img')).toHaveCount(1, { timeout: 10_000 });
  console.log('accept del selettore:', await win.locator('.sn-fb-file').getAttribute('accept'));
  console.log('stato:', await win.locator('.sn-fb-status').textContent());
});
