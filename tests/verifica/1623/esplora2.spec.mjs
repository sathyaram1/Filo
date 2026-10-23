// Verifica #1623, giro 2: esplorazione.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function suDisco(nomi, byte = PNG) {
  const dir = cartellaInCasa('filo-verifica-1623-');
  return nomi.map((n) => { const p = join(dir, n); writeFileSync(p, byte); return p; });
}

async function lascia(page, files, { x = 200, y = 200, fasi = ['dragEnter', 'dragOver', 'drop'] } = {}) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of fasi) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await s.detach().catch(() => {});
}

const statoAiuto = (app, page) => nelMondoDiFilo(app, page, () => ({
  aperto: !!globalThis.SN_SIDEBAR?.isOpen?.(),
  allegati: (globalThis.__filoSidebarTest?.allegati?.() || []).map((a) => a.nome),
  testo: document.querySelector('.sn-sidebar-input textarea')?.value || '',
  fuoco: document.activeElement === document.querySelector('.sn-sidebar-input textarea'),
}));

async function home(app) {
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(page); }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#input')).toBeVisible();
  return page;
}

const SITO = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh">un sito</body></html>';

test('E1 home: annullato il trascinamento il campo si spegne; spostandosi resta acceso', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  const [foto] = suDisco(['foto.png']);
  await lascia(page, [foto], { x: 60, y: 60, fasi: ['dragEnter', 'dragOver'] });
  await expect(page.locator('#inputForm')).toHaveClass(/dash-input-bersaglio/);
  const box = await page.locator('#inputForm').boundingBox();
  await lascia(page, [foto], { x: box.x + 20, y: box.y + 10, fasi: ['dragOver'] });
  await lascia(page, [foto], { x: 300, y: 500, fasi: ['dragOver'] });
  await expect(page.locator('#inputForm')).toHaveClass(/dash-input-bersaglio/);
  await lascia(page, [foto], { x: 300, y: 500, fasi: ['dragCancel'] });
  await expect(page.locator('#inputForm')).not.toHaveClass(/dash-input-bersaglio/, { timeout: 3_000 });
});

test('E3 sito: Aiuto aperto con un testo scritto, l’immagine si aggiunge e il testo resta', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const [foto] = suDisco(['foto.png']);
  await lascia(page, [foto]);
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ aperto: true, allegati: ['foto.png'] });
  await page.keyboard.type('cosa è questa');
  const [foto2] = suDisco(['due.png']);
  await lascia(page, [foto2], { x: 100, y: 300 });
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ allegati: ['foto.png', 'due.png'], testo: 'cosa è questa', fuoco: true });
});

test('E4 sito: un editor contenteditable che il rilascio non lo gestisce: all’Aiuto, nell’editor niente', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;height:100vh"><div id="ed" contenteditable style="position:fixed;left:40px;top:40px;width:500px;height:300px;border:1px solid">scrivi</div></body></html>`);
  const [foto] = suDisco(['foto.png']);
  await lascia(page, [foto], { x: 200, y: 150 });
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ aperto: true, allegati: ['foto.png'] });
  expect(await page.evaluate(() => document.getElementById('ed').innerHTML)).toBe('scrivi');
});

test('E15 sito: immagine lasciata sulla casella dell’Aiuto aperto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const [foto] = suDisco(['foto.png']);
  await lascia(page, [foto]);
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ aperto: true, allegati: ['foto.png'] });
  const p = await nelMondoDiFilo(app, page, () => { const r = document.querySelector('.sn-sidebar-input textarea').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const [foto2] = suDisco(['due.png']);
  await lascia(page, [foto2], p);
  await expect.poll(() => statoAiuto(app, page), { timeout: 8_000 }).toMatchObject({ allegati: ['foto.png', 'due.png'] });
  const vera = Buffer.from(await app.evaluate(({ nativeImage }) => {
    const w = 160, h = 100, px = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) px.set(i % w < w / 2 ? [60, 120, 200, 255] : [40, 160, 90, 255], i * 4);
    return nativeImage.createFromBitmap(px, { width: w, height: h }).toPNG().toString('base64');
  }), 'base64');
  const [f3] = suDisco(['vera.png'], vera);
  await lascia(page, [f3], { x: 100, y: 300 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/v1623-aiuto-chiaro.png' });
  await page.evaluate(() => chrome.runtime?.sendMessage?.({ type: self.SN_MSG?.MSG?.UPDATE_SETTINGS, settings: { theme: 'dark' } })).catch(() => {});
  await nelMondoDiFilo(app, page, () => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } })).catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tests/.shots/v1623-aiuto-scuro.png' });
});
