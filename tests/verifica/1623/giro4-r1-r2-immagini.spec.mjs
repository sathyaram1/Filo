// Verifica #1623, giro 4: r1 nella home un'immagine oltre i 4 MB senza percorso (incollata) deve entrare, come
// nell'Aiuto che la rimpicciolisce; r2 un'immagine in un formato che il modello non legge (SVG) va convertita.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';

async function home(app) {
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(page); }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#input')).toBeVisible();
  return page;
}

test('r1 home: una foto vera oltre i 4 MB incollata entra nel messaggio, come nell’Aiuto', async ({ app }) => {
  const page = await home(app);
  // Una foto rumorosa da 1800×1200: il PNG supera i 4 MB, come un'immagine copiata da una pagina o una schermata grande.
  const b64 = await app.evaluate(({ nativeImage }) => {
    const w = 1800, h = 1200, px = Buffer.alloc(w * h * 4);
    for (let i = 0; i < px.length; i++) px[i] = (i % 4 === 3) ? 255 : (Math.random() * 256) | 0;
    return nativeImage.createFromBitmap(px, { width: w, height: h }).toPNG().toString('base64');
  });
  expect(Buffer.from(b64, 'base64').length).toBeGreaterThan(4 * 1024 * 1024);
  await page.evaluate((dati) => {
    const u = Uint8Array.from(atob(dati), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([u], 'image.png', { type: 'image/png' }));
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, b64);
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 10_000 });
});

test('r2 Aiuto: un’immagine SVG lasciata su un sito parte in un formato che il modello legge', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh">x</body></html>');
  const svg = join(cartellaInCasa('filo-verifica-1623-'), 'logo.svg');
  writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>');
  await nelMondoDiFilo(app, page, () => {
    globalThis.__richieste = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === globalThis.SN_MSG.MSG.AI_REQUEST && m.action === globalThis.SN_CONST.ACTIONS.HELP) {
        globalThis.__richieste.push(m.payload);
        return Promise.resolve({ ok: true, text: '{"text":"Un quadrato rosso.","status":"done"}' });
      }
      return orig(m, ...r);
    };
    return 1;
  });
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files: [svg], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x: 200, y: 200, data });
  await s.detach().catch(() => {});
  await expect.poll(() => nelMondoDiFilo(app, page, () => (globalThis.__filoSidebarTest?.allegati?.() || []).length), { timeout: 8_000 }).toBe(1);
  await page.keyboard.type('cos’è?');
  await page.keyboard.press('Enter');
  await expect.poll(() => nelMondoDiFilo(app, page, () => globalThis.__richieste.length), { timeout: 10_000 }).toBeGreaterThan(0);
  const tipi = await nelMondoDiFilo(app, page, () => globalThis.__richieste[0].history
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((c) => c.type === 'image_url').map((c) => c.image_url.url.slice(5, c.image_url.url.indexOf(';'))));
  expect(tipi).toHaveLength(1);
  expect(['image/png', 'image/jpeg', 'image/webp', 'image/gif']).toContain(tipi[0]);
});
