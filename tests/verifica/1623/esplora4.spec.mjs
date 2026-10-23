// Esplorazione verifica #1623 giro 4: aspetto e casi di bordo.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PNG_GRANDE = Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024 + 1024)]);
function suDisco(nomi, byte = PNG) {
  const dir = cartellaInCasa('filo-esplora4-');
  return nomi.map((n) => { const p = join(dir, n); writeFileSync(p, byte); return p; });
}
async function lascia(page, files, { x = 200, y = 200, fasi = ['dragEnter', 'dragOver', 'drop'] } = {}) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of fasi) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await s.detach().catch(() => {});
}
async function home(app) {
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(page); }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#input')).toBeVisible();
  return page;
}
const SITO = '<!doctype html><html><head><meta charset="utf-8"><title>Sito</title></head><body style="margin:0;height:100vh;font:16px sans-serif"><p>Un sito.</p></body></html>';

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}: home accesa e Aiuto con allegati`, async ({ app, shell, openTab, testServer }) => {
    await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t; }, tema);
    const page = await home(app);
    const foto = suDisco(['a.png', 'b.png']);
    await lascia(page, foto, { x: 120, y: 120, fasi: ['dragEnter', 'dragOver'] });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/es4-home-accesa-${tema}.png` });
    await lascia(page, foto, { x: 120, y: 120, fasi: ['drop'] });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/es4-home-dopo-${tema}.png` });
    const sito = await testServer.openReady(openTab, SITO);
    await lascia(sito, foto);
    await page.waitForTimeout(800);
    await sito.screenshot({ path: `tests/.shots/es4-aiuto-${tema}.png` });
  });
}

test('home: annullato il trascinamento il campo si spegne', async ({ app }) => {
  const page = await home(app);
  const foto = suDisco(['a.png']);
  await lascia(page, foto, { x: 120, y: 120, fasi: ['dragEnter', 'dragOver', 'dragCancel'] });
  await page.waitForTimeout(300);
  console.log('ACCESO DOPO ANNULLA', await page.locator('#inputForm').getAttribute('class'));
});

test('sito: dodici immagini insieme', async ({ app, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, SITO);
  const foto = suDisco(Array.from({ length: 12 }, (_, i) => `f${i}.png`));
  await lascia(sito, foto);
  await page_wait(sito);
  const n = await nelMondoDiFilo(app, sito, () => (globalThis.__filoSidebarTest?.allegati?.() || []).length);
  console.log('DODICI', n);
});
async function page_wait(p) { await p.waitForTimeout(2000); }

test('home: Ctrl+V vero di un’immagine oltre i 4 MB', async ({ app }) => {
  const page = await home(app);
  await app.evaluate(async ({ clipboard, nativeImage }) => {
    // un'immagine rumorosa grande: il PNG supera i 4 MB
    const w = 1800, h = 1200;
    const buf = Buffer.alloc(w * h * 4);
    for (let i = 0; i < buf.length; i++) buf[i] = (Math.random() * 256) | 0;
    const img = nativeImage.createFromBitmap(buf, { width: w, height: h });
    clipboard.writeImage(img);
    return img.toPNG().length;
  }).then((n) => console.log('PNG BYTE', n));
  await page.locator('#input').click();
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(1500);
  console.log('ANTEPRIME', await page.locator('#imgPreviews .dash-img-preview img').count());
  console.log('TOAST', await page.locator('.sn-toast').allTextContents());
});
