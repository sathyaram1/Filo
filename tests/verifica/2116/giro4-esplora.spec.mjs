// #2116 giro 4 — esplorazione: zoom della pagina, componenti aperti e chiusi, quanto resta nascosto il riquadro.
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

async function superaAvviso(app) {
  const coperta = async () => (await copertura(app).catch(() => null))?.coperta === true;
  const fine = Date.now() + 5_000;
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
  await strato.evaluate(() => {
    globalThis.__nascosto = [];
    const t0 = performance.now();
    new MutationObserver((ms) => {
      for (const m of ms) globalThis.__nascosto.push([Math.round(performance.now() - t0), m.target.style.visibility || 'vis']);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['style'], subtree: true });
  });
  await strato.locator('.sn-fb-send').click();
  return strato;
}

async function pixelDiversi(page, [a, b], r) {
  return page.evaluate(async ([a, b, r]) => {
    const pixel = async (url) => {
      const byte = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
      const img = await createImageBitmap(new Blob([byte]));
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const sx = img.width / window.innerWidth, sy = img.height / window.innerHeight;
      return ctx.getImageData(Math.round(r.left * sx), Math.round(r.top * sy), Math.round(r.width * sx), Math.round(r.height * sy)).data;
    };
    const [pa, pb] = [await pixel(a), await pixel(b)];
    let n = 0;
    for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) n++;
    return n;
  }, [a, b, r]);
}
const dentro = (b) => ({ left: b.x + 3, top: b.y + 3, width: b.width - 6, height: b.height - 6 });

async function dueFoto(app, page, riempi) {
  const immagini = [];
  for (const [i, v] of [['Gatto.Rosso.77', '4111 1111 1111 1111'], ['ab1', '5500 0000 0000 0004']].entries()) {
    await riempi(v);
    const strato = await mandaConSchermata(app, page, `Il tasto non risponde (${i + 1})`);
    await expect.poll(() => app.evaluate(() => globalThis.__rete.payload.length), { timeout: 15_000 }).toBe(i + 1);
    console.log('nascosto', JSON.stringify(await strato.evaluate(() => globalThis.__nascosto)));
    const img = await app.evaluate(() => globalThis.__rete.payload.at(-1).images.map((x) => x.dataUrl));
    expect(img, 'lo screenshot deve partire').toHaveLength(1);
    immagini.push(img[0]);
    await expect(strato.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 8_000 });
  }
  return immagini;
}

test('zoom 150%: password resa visibile e carta coperte', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"><title>Accesso</title></head><body>
    <div style="height:300px"></div><form>
    <p><label for="p">Password</label> <input id="p" type="password" style="width:300px;font-size:20px;outline:0;caret-color:transparent"></p>
    <p><label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:300px;font-size:20px;outline:0;caret-color:transparent"></p>
    </form><div style="height:2000px"></div></body></html>`);
  await superaAvviso(app);
  await reteFinta(app);
  await app.evaluate(({ webContents }, u) => webContents.getAllWebContents().find((w) => w.getURL() === u).setZoomFactor(1.5), page.url());
  await page.evaluate(() => window.scrollTo(0, 200));
  const immagini = await dueFoto(app, page, async ([pw, carta]) => {
    await page.evaluate(() => { document.querySelector('#p').type = 'password'; });
    await page.fill('#p', pw);
    await page.evaluate(() => { document.querySelector('#p').type = 'text'; });
    await page.fill('#c', carta);
  });
  expect(await pixelDiversi(page, immagini, dentro(await page.locator('#p').boundingBox())), 'password').toBe(0);
  expect(await pixelDiversi(page, immagini, dentro(await page.locator('#c').boundingBox())), 'carta').toBe(0);
});

test('componenti aperti e chiusi: carta coperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"><title>Cassa</title></head><body>
    <h1>Pagamento</h1><div id="aperto"></div><div id="chiuso"></div>
    <script>
      const st = 'width:300px;font-size:20px;outline:0;caret-color:transparent';
      const a = document.getElementById('aperto').attachShadow({ mode: 'open' });
      a.innerHTML = '<label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="' + st + '">';
      const c = document.getElementById('chiuso').attachShadow({ mode: 'closed' });
      c.innerHTML = '<label for="k">Numero della carta</label> <input id="k" autocomplete="cc-number" style="' + st + '">';
      window.__chiuso = c;
    </script></body></html>`);
  await superaAvviso(app);
  await reteFinta(app);
  const immagini = await dueFoto(app, page, async ([, carta]) => {
    await page.evaluate((v) => {
      for (const el of [document.getElementById('aperto').shadowRoot.getElementById('c'), window.__chiuso.getElementById('k')]) {
        el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, carta);
  });
  const box = (sel) => page.evaluate((s) => {
    const el = s === 'c' ? document.getElementById('aperto').shadowRoot.getElementById('c') : window.__chiuso.getElementById('k');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, sel);
  expect(await pixelDiversi(page, immagini, dentro(await box('c'))), 'carta nel componente aperto').toBe(0);
  expect(await pixelDiversi(page, immagini, dentro(await box('k'))), 'carta nel componente chiuso').toBe(0);
});
