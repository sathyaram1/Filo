// Verifica #2116 giro 1: lo screenshot del riquadro feedback copre i campi segreti anche fuori dal caso semplice.

import { test, expect } from '../../fixtures/electron.mjs';
import { vistaAvviso, copertura } from '../../helpers/avvisoSito.mjs';
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

async function superaAvvisoSeCe(app) {
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

async function manda(app, page, testo, { disegna = false } = {}) {
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-fb-modal')).toBeVisible();
  await strato.locator('.sn-fb-text').fill(testo);
  if (disegna) {
    await strato.mouse.move(20, 20);
    await strato.mouse.down();
    await strato.mouse.move(60, 60, { steps: 5 });
    await strato.mouse.up();
  } else {
    await strato.locator('.sn-fb-clear').click();
  }
  await expect(strato.locator('.sn-fb-clear')).toHaveAttribute('aria-pressed', 'true');
  await strato.locator('.sn-fb-send').click();
  return strato;
}

async function dueFoto(app, page, scrivi, opz = {}) {
  await reteFinta(app);
  const out = [];
  for (const [i, v] of ['4111 1111 1111 1111', '5500 0000 0000 0004'].entries()) {
    await scrivi(v);
    const strato = await manda(app, page, `prova ${i}`, opz);
    await expect.poll(() => app.evaluate(() => globalThis.__rete.payload.length), { timeout: 15_000 }).toBe(i + 1);
    await expect(strato.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 8_000 });
    const img = await app.evaluate(() => globalThis.__rete.payload.at(-1).images.map((x) => x.dataUrl));
    expect(img, 'lo screenshot deve partire').toHaveLength(1);
    out.push(img[0]);
  }
  return out;
}

// Con la barra in alto nell'immagine annotata la pagina comincia più in basso: `alto` in px dell'immagine.
async function pixelDiversi(page, [a, b], r) {
  return page.evaluate(async ([a, b, r]) => {
    const pixel = async (url) => {
      const byte = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
      const img = await createImageBitmap(new Blob([byte]));
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const sx = img.width / window.innerWidth;
      const alto = img.height - Math.round(window.innerHeight * sx);
      return ctx.getImageData(Math.round(r.left * sx), alto + Math.round(r.top * sx), Math.round(r.width * sx), Math.round(r.height * sx)).data;
    };
    const [pa, pb] = [await pixel(a), await pixel(b)];
    let n = 0;
    for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) n++;
    return n;
  }, [a, b, r]);
}

const dentro = (b) => ({ left: b.x + 3, top: b.y + 3, width: b.width - 6, height: b.height - 6 });
const STILE = 'width:300px;font-size:20px;outline:0;caret-color:transparent';
const modulo = (campo, prima = '') => `<!doctype html><html><head><meta charset="utf-8"><title>Pagamento</title></head><body>
  <h1>Pagamento</h1>${prima}<form><div>${campo}</div><button type="button">Paga</button></form></body></html>`;

test('carta nel riquadro di un altro sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const riquadro = testServer.html(`<!doctype html><html><body style="margin:0;background:#fff">
    <input id="n" autocomplete="cc-number" style="${STILE};border:0"></body></html>`, { pubblico: true });
  const page = await testServer.openReady(openTab, modulo(`<label>Carta</label><iframe id="f" src="${riquadro}" style="width:340px;height:40px;border:0;padding:4px"></iframe>`));
  const campo = page.frameLocator('#f').locator('#n');
  await expect(campo).toBeVisible({ timeout: 10_000 });
  await superaAvvisoSeCe(app);
  const foto = await dueFoto(app, page, (v) => campo.fill(v));
  const f = await page.locator('#f').boundingBox();
  expect(await pixelDiversi(page, foto, { left: f.x + 4, top: f.y + 4, width: 300, height: f.height - 8 })).toBe(0);
});

test('carta in un componente chiuso', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, modulo(`<carta-chiusa></carta-chiusa><script>
    customElements.define('carta-chiusa', class extends HTMLElement { constructor() { super();
      const r = this.attachShadow({ mode: 'closed' }); window.__radice = r;
      r.innerHTML = '<label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="${STILE}">'; } });
  </script>`));
  await superaAvvisoSeCe(app);
  const foto = await dueFoto(app, page, (v) => page.evaluate((x) => { window.__radice.querySelector('input').value = x; }, v));
  const b = await page.evaluate(() => { const r = window.__radice.querySelector('input').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  expect(await pixelDiversi(page, foto, dentro(b))).toBe(0);
});

test('carta in fondo a una pagina lunga, scorsa fin lì', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, modulo(`<label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="${STILE}">`,
    '<div style="height:1600px;background:linear-gradient(#fff,#ddd)"></div>'));
  await superaAvvisoSeCe(app);
  await page.evaluate(() => document.querySelector('#c').scrollIntoView({ block: 'center' }));
  const foto = await dueFoto(app, page, (v) => page.fill('#c', v));
  const b = await page.locator('#c').boundingBox();
  expect(b.y).toBeGreaterThan(0);
  expect(await pixelDiversi(page, foto, dentro(b))).toBe(0);
});

test('carta con la pagina ingrandita', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, modulo(`<label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="${STILE}">`));
  await superaAvvisoSeCe(app);
  await app.evaluate(({ webContents }, u) => { webContents.getAllWebContents().find((w) => w.getURL() === u).setZoomFactor(1.5); }, page.url());
  await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeGreaterThan(1.4);
  const foto = await dueFoto(app, page, (v) => page.fill('#c', v));
  const b = await page.locator('#c').boundingBox();
  expect(await pixelDiversi(page, foto, dentro(b))).toBe(0);
});

test('carta con un disegno sopra la pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, modulo(`<label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="${STILE}">`));
  await superaAvvisoSeCe(app);
  const foto = await dueFoto(app, page, (v) => page.fill('#c', v), { disegna: true });
  const b = await page.locator('#c').boundingBox();
  expect(await pixelDiversi(page, foto, dentro(b))).toBe(0);
});
