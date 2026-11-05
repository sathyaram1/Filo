// Esplorazione del giro 3 di #2116: strade e stress dello screenshot del feedback coperto.
import { test, expect } from '../../fixtures/electron.mjs';
import { copertura, vistaAvviso } from '../../helpers/avvisoSito.mjs';
import { nelMondoDiFilo, paginaDelloStrato } from '../../helpers/riquadri.mjs';

async function reteFinta(app) {
  await app.evaluate(() => {
    globalThis.__rete = { payload: [] };
    globalThis.SN_FEEDBACK.submit = async (p) => {
      globalThis.__rete.payload.push(p);
      return { id: `fb-${globalThis.__rete.payload.length}`, seq: 1, failed: [] };
    };
  });
}

async function superaAvviso(app) {
  const coperta = async () => (await copertura(app).catch(() => null))?.coperta === true;
  const fine = Date.now() + 4_000;
  while (!(await coperta())) {
    if (Date.now() > fine) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  const avviso = await vistaAvviso(app);
  await avviso.getByRole('button', { name: 'Continua' }).click();
  await expect.poll(coperta, { timeout: 6_000 }).toBe(false);
}

async function mandaConSchermata(app, page, testo) {
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-fb-modal')).toBeVisible();
  await strato.locator('.sn-fb-text').fill(testo);
  await strato.locator('.sn-fb-clear').click();
  await strato.locator('.sn-fb-send').click();
  return strato;
}

async function stats(page, url, r) {
  return page.evaluate(async ([url, r]) => {
    const byte = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
    const img = await createImageBitmap(new Blob([byte]));
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const sx = img.width / window.innerWidth, sy = img.height / window.innerHeight;
    const d = ctx.getImageData(Math.round(r.left * sx), Math.round(r.top * sy), Math.round(r.width * sx), Math.round(r.height * sy)).data;
    const visti = new Set();
    for (let i = 0; i < d.length; i += 4) visti.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return { colori: visti.size, esempio: [...visti].slice(0, 4) };
  }, [url, r]);
}

test('esplora: riquadro di un altro sito senza segreti', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const riquadro = testServer.html(`<!doctype html><html><body style="margin:0;background:#fde">
    <h2 style="color:#c00">Il video non parte</h2><p style="color:#06c">Errore 503 dal lettore</p></body></html>`, { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"><title>Video</title></head><body>
    <h1>Pagina col video</h1><iframe id="f" src="${riquadro}" style="width:400px;height:200px;border:0"></iframe></body></html>`);
  await expect(page.frameLocator('#f').locator('h2')).toBeVisible({ timeout: 10_000 });
  await reteFinta(app);
  const strato = await mandaConSchermata(app, page, 'Il video non parte');
  await expect.poll(() => app.evaluate(() => globalThis.__rete.payload.length), { timeout: 15_000 }).toBe(1);
  await expect(strato.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 8_000 });
  const img = await app.evaluate(() => globalThis.__rete.payload[0].images.map((x) => x.dataUrl));
  console.log('ESPLORA riquadro immagini', img.length);
  const f = await page.locator('#f').boundingBox();
  const s = await stats(page, img[0], { left: f.x, top: f.y, width: f.width, height: f.height });
  console.log('ESPLORA riquadro colori', JSON.stringify(s));
  expect(s.colori, 'il contenuto del riquadro senza segreti si vede').toBeGreaterThan(3);
});

test('esplora: pagina pesante', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const righe = Array.from({ length: 3000 }, (_, i) => `<div class="r"><span>riga ${i}</span>${'<b>x</b>'.repeat(30)}</div>`).join('');
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"><title>Pesante</title></head><body>
    <h1>Elenco lungo</h1>${righe}</body></html>`);
  console.log('ESPLORA elementi', await page.evaluate(() => document.querySelectorAll('*').length));
  await reteFinta(app);
  const t0 = Date.now();
  await mandaConSchermata(app, page, 'Lista lenta');
  await expect.poll(() => app.evaluate(() => globalThis.__rete.payload.length), { timeout: 30_000 }).toBe(1);
  console.log('ESPLORA pesante ms', Date.now() - t0);
  const n = await app.evaluate(() => globalThis.__rete.payload[0].images.length);
  console.log('ESPLORA pesante immagini', n);
  expect(n).toBe(1);
});

test('esplora: numero di carta in un campo qualunque e pagina ingrandita', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"><title>Ordine</title></head><body>
    <h1>Note per l'ordine</h1><p><input id="c" style="width:300px;font-size:20px;outline:0;caret-color:transparent"></p></body></html>`);
  await superaAvviso(app);
  await reteFinta(app);
  await app.evaluate(({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => /127\.0\.0\.1|localhost/.test(w.getURL()) && w.getURL().includes('/'));
    if (wc) wc.setZoomFactor(1.5);
  });
  await new Promise((r) => setTimeout(r, 500));
  const immagini = [];
  for (const [i, carta] of ['4111 1111 1111 1111', '5500 0000 0000 0004'].entries()) {
    await page.fill('#c', carta);
    const strato = await mandaConSchermata(app, page, `ordine ${i}`);
    await expect.poll(() => app.evaluate(() => globalThis.__rete.payload.length), { timeout: 15_000 }).toBe(i + 1);
    await expect(strato.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 8_000 });
    const img = await app.evaluate(() => globalThis.__rete.payload.at(-1).images.map((x) => x.dataUrl));
    console.log('ESPLORA carta immagini', img.length);
    immagini.push(img[0]);
  }
  const c = await page.locator('#c').boundingBox();
  const r = { left: c.x + 3, top: c.y + 3, width: c.width - 6, height: c.height - 6 };
  const diff = await page.evaluate(async ([a, b, r]) => {
    const px = async (url) => {
      const byte = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (ch) => ch.charCodeAt(0));
      const img = await createImageBitmap(new Blob([byte]));
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
      const sx = img.width / window.innerWidth, sy = img.height / window.innerHeight;
      return ctx.getImageData(Math.round(r.left * sx), Math.round(r.top * sy), Math.round(r.width * sx), Math.round(r.height * sy)).data;
    };
    const [pa, pb] = [await px(a), await px(b)];
    let n = 0; for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) n++;
    return n;
  }, [immagini[0], immagini[1], r]);
  console.log('ESPLORA carta diff', diff);
  expect(diff).toBe(0);
});
