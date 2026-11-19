// Verifica #1664 giro 2, rilievo 2: nel riquadro «Invia feedback» una foto grande si rimpicciolisce prima di entrare,
// e ci vuole il suo tempo. Chi lascia le foto e preme subito Invia deve vederle partire, non perderle in silenzio.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  let win = null;
  await expect.poll(() => {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    return !!win;
  }, { timeout: 10_000 }).toBe(true);
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

test('r2 tre foto grandi lasciate nel riquadro e Invia premuto subito: le foto partono con la segnalazione', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 4000; c.height = 3000;
    const g = c.getContext('2d');
    const im = g.createImageData(c.width, c.height);
    for (let i = 0; i < im.data.length; i++) im.data[i] = (Math.random() * 256) | 0;
    g.putImageData(im, 0, 0);
    window.__foto = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 1));
    window.__partiti = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === globalThis.SN_MSG.MSG.SUBMIT_FEEDBACK) {
        window.__partiti.push({ immagini: (m.payload.images || []).length });
        return Promise.resolve({ ok: true, id: 'fb-1' });
      }
      return orig(m, ...r);
    };
  });
  await page.locator('.sn-fb-modal textarea').first().fill('Le foto del difetto sullo schermo.');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    for (const n of [1, 2, 3]) dt.items.add(new File([window.__foto], `IMG_${n}.JPG`, { type: 'image/jpeg' }));
    document.querySelector('.sn-fb-modal').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.screenshot({ path: 'tests/.shots/verifica-1664-g2-invia-subito.png' });
  await page.locator('.sn-fb-send').click();

  await expect.poll(() => page.evaluate(() => window.__partiti.length), { timeout: 20_000 }).toBeGreaterThan(0);
  const [p] = await page.evaluate(() => window.__partiti);
  expect(p.immagini, 'le tre foto lasciate partono con la segnalazione').toBe(3);
});
