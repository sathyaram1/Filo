// Verifica #2116 giro 2, esplorazione: la copertura dello screenshot del feedback con zoom, scorrimento, riquadro
// dello stesso sito, componente chiuso, disegno sulla pagina.

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
  const fine = Date.now() + 4_000;
  while (!(await coperta())) {
    if (Date.now() > fine) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  const avviso = await vistaAvviso(app);
  await avviso.getByRole('button', { name: 'Continua' }).click();
  await expect.poll(coperta, { timeout: 6_000 }).toBe(false);
}

async function mandaConSchermata(app, page, testo, { disegna = false } = {}) {
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-fb-modal')).toBeVisible();
  await strato.locator('.sn-fb-text').fill(testo);
  if (disegna) {
    await strato.mouse.move(20, 20);
    await strato.mouse.down();
    await strato.mouse.move(60, 40, { steps: 5 });
    await strato.mouse.up();
    await expect(strato.locator('.sn-fb-clear')).toHaveText('Cancella');
  } else {
    await strato.locator('.sn-fb-clear').click();
  }
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

async function dueScatti(app, page, riempi, opz) {
  const immagini = [];
  for (const [i, v] of ['Gatto.Rosso.77 4111111111111111', 'ab1 5500000000000004'].entries()) {
    await riempi(v);
    const strato = await mandaConSchermata(app, page, `Prova ${i + 1}`, opz);
    await expect.poll(() => app.evaluate(() => globalThis.__rete.payload.length), { timeout: 20_000 }).toBe(i + 1);
    await expect(strato.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 8_000 });
    const img = await app.evaluate(() => globalThis.__rete.payload.at(-1).images.map((x) => x.dataUrl));
    expect(img, 'lo screenshot deve partire').toHaveLength(1);
    immagini.push(img[0]);
  }
  return immagini;
}

const rettangolo = (page, sel) => page.evaluate((s) => {
  const b = document.querySelector(s).getBoundingClientRect();
  return { left: b.left + 3, top: b.top + 3, width: b.width - 6, height: b.height - 6 };
}, sel);

test('zoom al 150% e pagina scorsa: la password resta coperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"><title>Accesso</title></head><body>
    <div style="height:900px"><h1>Area clienti</h1></div>
    <p><input id="p" type="password" style="width:300px;font-size:20px;outline:0;caret-color:transparent"></p><div style="height:900px"></div></body></html>`);
  await superaAvviso(app);
  await reteFinta(app);
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.tabs.find((t) => t.id === tm.activeId).view.webContents.setZoomFactor(1.5);
  });
  await page.evaluate(() => document.querySelector('#p').scrollIntoView({ block: 'center' }));
  const immagini = await dueScatti(app, page, async (v) => {
    await page.evaluate(() => { document.querySelector('#p').type = 'password'; });
    await page.fill('#p', v.split(' ')[0]);
    await page.evaluate(() => { document.querySelector('#p').type = 'text'; });
  });
  expect(await pixelDiversi(page, immagini, await rettangolo(page, '#p')), 'password leggibile con zoom e scorrimento').toBe(0);
});

test('riquadro dello stesso sito con la password: coperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const riquadro = testServer.html(`<!doctype html><html><body style="margin:0;background:#fff">
    <input id="n" autocomplete="cc-number" style="width:300px;font-size:20px;border:0;outline:0;caret-color:transparent"></body></html>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"><title>Cassa</title></head><body>
    <h1>Pagamento</h1><iframe id="f" src="${riquadro}" style="width:340px;height:40px;border:0;padding:4px"></iframe></body></html>`);
  const campo = page.frameLocator('#f').locator('#n');
  await expect(campo).toBeVisible({ timeout: 10_000 });
  await superaAvviso(app);
  await reteFinta(app);
  const immagini = await dueScatti(app, page, (v) => campo.fill(v.split(' ')[1]));
  const f = await rettangolo(page, '#f');
  expect(await pixelDiversi(page, immagini, { left: f.left + 1, top: f.top + 1, width: 300, height: f.height - 2 }),
    'carta leggibile nel riquadro dello stesso sito').toBe(0);
});

test('componente chiuso con la carta: coperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"><title>Cassa</title></head><body>
    <h1>Pagamento</h1><div id="host"></div><script>
    const r = document.getElementById('host').attachShadow({ mode: 'closed' });
    r.innerHTML = '<input id="n" autocomplete="cc-number" style="width:300px;font-size:20px;border:0;outline:0;caret-color:transparent">';
    window.__campo = r.getElementById('n');
    </script></body></html>`);
  await superaAvviso(app);
  await reteFinta(app);
  const immagini = await dueScatti(app, page, async (v) => {
    await page.evaluate(() => window.__campo.focus());
    await page.keyboard.press('Control+A');
    await page.keyboard.type(v.split(' ')[1]);
    await page.evaluate(() => window.__campo.blur());
  });
  const r = await rettangolo(page, '#host');
  expect(await pixelDiversi(page, immagini, { left: r.left, top: r.top, width: 290, height: r.height }),
    'carta leggibile nel componente chiuso').toBe(0);
});

test('screenshot annotato col disegno: la carta resta coperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><meta charset="utf-8"><title>Cassa</title></head><body>
    <h1>Pagamento</h1><p style="margin-top:200px"><input id="c" autocomplete="cc-number" style="width:300px;font-size:20px;outline:0;caret-color:transparent"></p></body></html>`);
  await superaAvviso(app);
  await reteFinta(app);
  const immagini = await dueScatti(app, page, (v) => page.fill('#c', v.split(' ')[1]), { disegna: true });
  expect(await pixelDiversi(page, immagini, await rettangolo(page, '#c')), 'carta leggibile nello screenshot annotato').toBe(0);
});
