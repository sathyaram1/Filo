// Verifica #1721 giro 4: esplorazione della copertura (zoom CSS, riquadro che si sposta fra le misure).

import { test, expect } from '../../fixtures/electron.mjs';

const ROSA = [0xc9, 0x25, 0x85];
const tinta = ([r, g, b]) => `rgb(${r},${g},${b})`;

// La foto per un modello della scheda in vista, e quanti pixel del colore ci sono.
async function fotoERosa(app, rgb = ROSA) {
  return app.evaluate(async ({ BrowserWindow }, c) => {
    const rq = process.mainModule.require;
    const Foto = rq(rq('node:path').join(process.cwd(), 'src/main/services/fotoDellaPagina.js'));
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    const r = await Foto.fotoPerModello(wc);
    const conta = (img) => {
      const b = img.toBitmap();
      let n = 0;
      for (let i = 0; i < b.length; i += 4) {
        if (Math.abs(b[i + 2] - c[0]) <= 40 && Math.abs(b[i + 1] - c[1]) <= 40 && Math.abs(b[i] - c[2]) <= 40) n++;
      }
      return n;
    };
    return { ok: r.ok, code: r.code || '', coperta: r.ok ? conta(r.img) : -1, piena: r.piena ? conta(r.piena) : -1 };
  }, rgb);
}

test('zoom CSS sul riquadro dello stesso sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo 1.234</body>`, { pubblico: true });
  const stesso = testServer.html(`<!doctype html><body style="margin:0"><iframe id="x" src="${altro}" style="width:150px;height:100px;border:0;display:block"></iframe></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0">
    <h1>Il tuo conto</h1>
    <iframe id="stesso" src="${stesso}" style="width:150px;height:100px;border:0;zoom:2.5"></iframe></body></html>`);
  await expect(page.frameLocator('#stesso').frameLocator('#x').locator('body')).toContainText('Saldo', { timeout: 10_000 });
  const r = await fotoERosa(app);
  console.log('ZOOM IFRAME', JSON.stringify(r));
});

test('zoom CSS su un antenato del riquadro dello stesso sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo 1.234</body>`, { pubblico: true });
  const stesso = testServer.html(`<!doctype html><body style="margin:0"><iframe id="x" src="${altro}" style="width:150px;height:100px;border:0;display:block"></iframe></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0">
    <h1>Il tuo conto</h1><div style="zoom:2.5">
    <iframe id="stesso" src="${stesso}" style="width:150px;height:100px;border:0"></iframe></div></body></html>`);
  await expect(page.frameLocator('#stesso').frameLocator('#x').locator('body')).toContainText('Saldo', { timeout: 10_000 });
  const r = await fotoERosa(app);
  console.log('ZOOM ANTENATO', JSON.stringify(r));
});

test('riquadro di un altro sito che si sposta a ogni fotogramma', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo 1.234</body>`, { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0">
    <h1>Il tuo conto</h1>
    <iframe id="x" src="${altro}" style="width:300px;height:200px;border:0;position:absolute;left:20px;top:80px"></iframe>
    <script>let k = 0; const f = () => { k ^= 1; document.getElementById('x').style.transform = k ? 'none' : 'translateX(-5000px)'; requestAnimationFrame(f); }; requestAnimationFrame(f);</script>
    </body></html>`);
  await expect(page.frameLocator('#x').locator('body')).toContainText('Saldo', { timeout: 10_000 });
  const esiti = [];
  for (let i = 0; i < 16; i++) esiti.push(await fotoERosa(app));
  console.log('OSCILLA', JSON.stringify(esiti));
});

test('riquadro di un altro sito che si sposta ogni 5 ms', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo 1.234</body>`, { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0">
    <h1>Il tuo conto</h1>
    <iframe id="x" src="${altro}" style="width:300px;height:200px;border:0;position:absolute;left:20px;top:80px"></iframe>
    <script>let k = 0; setInterval(() => { k ^= 1; document.getElementById('x').style.transform = k ? 'none' : 'translateX(-5000px)'; }, 5);</script>
    </body></html>`);
  await expect(page.frameLocator('#x').locator('body')).toContainText('Saldo', { timeout: 10_000 });
  const esiti = [];
  for (let i = 0; i < 16; i++) esiti.push(await fotoERosa(app));
  console.log('OSCILLA5', JSON.stringify(esiti));
});

test('pagina che scorre veloce con un riquadro piccolo di un altro sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo 1.234</body>`, { pubblico: true });
  let righe = '';
  for (let i = 0; i < 40; i++) righe += `<p style="height:150px;margin:0">riga ${i}</p><iframe src="${altro}" style="width:300px;height:40px;border:0;display:block"></iframe>`;
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0">
    ${righe}
    <script>let d = 15; setInterval(() => { if (scrollY > 5000) d = -15; if (scrollY <= 0) d = 15; scrollBy(0, d); }, 5);</script>
    </body></html>`);
  await page.waitForTimeout(1500);
  const esiti = [];
  for (let i = 0; i < 16; i++) esiti.push(await fotoERosa(app));
  console.log('SCORRE', JSON.stringify(esiti.map((e) => `${e.coperta}/${e.piena}`)));
});

test('pagina che scorre SCORRE600 con un riquadro piccolo di un altro sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo 1.234</body>`, { pubblico: true });
  let righe = '';
  for (let i = 0; i < 40; i++) righe += `<p style="height:150px;margin:0">riga ${i}</p><iframe src="${altro}" style="width:300px;height:40px;border:0;display:block"></iframe>`;
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0">
    ${righe}
    <script>let d = 3; setInterval(() => { if (scrollY > 5000) d = -3; if (scrollY <= 0) d = 3; scrollBy(0, d); }, 5);</script>
    </body></html>`);
  await page.waitForTimeout(1500);
  const esiti = [];
  for (let i = 0; i < 16; i++) esiti.push(await fotoERosa(app));
  console.log('SCORRE600', JSON.stringify(esiti.map((e) => `${e.coperta}/${e.piena}`)));
});

test('pagina che scorre SCORRE1200 con un riquadro piccolo di un altro sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const altro = testServer.html(`<!doctype html><body style="margin:0;background:${tinta(ROSA)}">Saldo 1.234</body>`, { pubblico: true });
  let righe = '';
  for (let i = 0; i < 40; i++) righe += `<p style="height:150px;margin:0">riga ${i}</p><iframe src="${altro}" style="width:300px;height:40px;border:0;display:block"></iframe>`;
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Conto</title></head><body style="margin:0">
    ${righe}
    <script>let d = 6; setInterval(() => { if (scrollY > 5000) d = -6; if (scrollY <= 0) d = 6; scrollBy(0, d); }, 5);</script>
    </body></html>`);
  await page.waitForTimeout(1500);
  const esiti = [];
  for (let i = 0; i < 16; i++) esiti.push(await fotoERosa(app));
  console.log('SCORRE1200', JSON.stringify(esiti.map((e) => `${e.coperta}/${e.piena}`)));
});
