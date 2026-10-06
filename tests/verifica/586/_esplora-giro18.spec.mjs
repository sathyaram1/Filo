// Esplorazione giro 18: il menu del tasto destro su pagine web comuni risponde a un clic vero su Incolla?
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CAMPO = '<input id="c" style="margin:40px;width:300px;font:16px sans-serif">';

async function incolla(app, page, dove, testo, { attesa = 500 } = {}) {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);
  const box = await dove.locator('#c').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  const voce = dove.locator('.sn-menu .sn-menu-paste-main').first();
  const comparso = await voce.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
  if (!comparso) return 'menu assente';
  const coperto = await dove.evaluate(() => {
    const el = document.querySelector('.sn-menu .sn-menu-paste-main');
    const r = el.getBoundingClientRect();
    const s = document.elementFromPoint(r.left + 10, r.top + r.height / 2);
    return s && (s === el || el.contains(s)) ? 'scoperto' : `coperto da ${s && (s.id || s.tagName)}`;
  });
  await sleep(attesa);
  const bb = await voce.boundingBox();
  await page.mouse.move(bb.x + 10, bb.y + bb.height / 2, { steps: 3 });
  await sleep(150);
  await page.mouse.down(); await page.mouse.up();
  const ok = await expect.poll(() => dove.locator('#c').inputValue(), { timeout: 3000 }).toBe(testo).then(() => true, () => false);
  return ok ? 'incollato' : `non incollato (${coperto})`;
}

test('base: pagina semplice', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>Base</title><body>${CAMPO}</body>`);
  console.log('ESITO base', await incolla(app, page, page, 'base-586'));
});

test('dialogo modale della pagina', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>Dialogo</title><body>
  <dialog id="d" style="width:420px;height:300px">${CAMPO}</dialog><script>document.getElementById('d').showModal()</script></body>`);
  console.log('ESITO dialogo', await incolla(app, page, page, 'dialogo-586'));
  await page.locator('#c').click({ button: 'right' });
  await sleep(600);
  await page.screenshot({ path: 'tests/.shots/586-giro18-dialogo.png' });
  console.log('ESITO dialogo-inerte', await page.evaluate(() => { const m = document.querySelector('.sn-menu'); return m ? { inerte: m.matches(':popover-open') ? 'popover' : 'no', da: document.elementFromPoint(m.getBoundingClientRect().left + 20, m.getBoundingClientRect().top + 20)?.className } : 'nessun menu'; }));
});

test('dialogo non modale della pagina', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>Dialogo2</title><body>
  <dialog id="d" open style="width:420px;height:300px">${CAMPO}</dialog></body>`);
  console.log('ESITO dialogo-non-modale', await incolla(app, page, page, 'dialogo2-586'));
});

for (const [nome, stile] of [['nudo', ''], ['opacita99', 'opacity:.99'], ['scala', 'transform:scale(.9);transform-origin:0 0'], ['ruotato', 'transform:rotate(0.5deg)'], ['traslato', 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)']]) {
  test(`riquadro incorporato ${nome}`, async ({ app, openTab, testServer }) => {
    const dentro = testServer.html(`<!doctype html><title>Dentro</title><body style="margin:0">${CAMPO}</body>`);
    const page = await testServer.openReady(openTab, `<!doctype html><title>Fuori</title><body style="margin:0">
      <div style="${stile};width:700px;height:520px"><iframe id="f" src="${dentro}" style="width:700px;height:520px;border:0"></iframe></div></body>`);
    await page.frameLocator('#f').locator('#c').waitFor({ state: 'visible', timeout: 8000 });
    const fr = page.frame({ url: dentro });
    await sleep(1500);
    console.log(`ESITO riquadro-${nome}`, await incolla(app, page, fr, `riquadro-${nome}`));
  });
}

test('pagina con zoom sul documento', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html style="zoom:.8"><title>Zoom</title><body>${CAMPO}</body></html>`);
  console.log('ESITO zoom-html', await incolla(app, page, page, 'zoom-586'));
});

test('pagina con filtro sul documento', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html style="filter:grayscale(1)"><title>Grigio</title><body>${CAMPO}</body></html>`);
  console.log('ESITO filtro-html', await incolla(app, page, page, 'grigio-586'));
});

test('pagina con opacità sul documento', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html style="opacity:.98"><title>Velo</title><body>${CAMPO}</body></html>`);
  console.log('ESITO opacita-html', await incolla(app, page, page, 'velo-586'));
});

for (const ms of [0, 60, 120, 200]) {
  test(`clic veloce dopo ${ms} ms`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, `<!doctype html><title>Veloce</title><body>${CAMPO}</body>`);
    console.log(`ESITO veloce-${ms}`, await incolla(app, page, page, `veloce-${ms}`, { attesa: ms }));
  });
}

test('riquadro basso: il menu non ci sta dentro', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html(`<!doctype html><title>Dentro</title><body style="margin:0"><input id="c" style="margin:10px;width:300px"></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><title>Fuori</title><body style="margin:20px">
    <iframe id="f" src="${dentro}" style="width:600px;height:160px;border:1px solid #888"></iframe><p>sotto</p></body>`);
  await page.frameLocator('#f').locator('#c').waitFor({ state: 'visible', timeout: 8000 });
  await sleep(1500);
  const fr = page.frame({ url: dentro });
  console.log('ESITO riquadro-basso', await incolla(app, page, fr, 'basso-586'));
  await page.screenshot({ path: 'tests/.shots/586-giro18-riquadro-basso.png' });
});

test('riquadro con la bolla della chat della pagina sopra un angolo', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html(`<!doctype html><title>Dentro</title><body style="margin:0">${CAMPO}</body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><title>Fuori</title><body style="margin:0">
    <iframe id="f" src="${dentro}" style="width:100%;height:96vh;border:0"></iframe>
    <div style="position:fixed;left:200px;top:200px;width:60px;height:60px;border-radius:50%;background:#36c"></div></body>`);
  await page.frameLocator('#f').locator('#c').waitFor({ state: 'visible', timeout: 8000 });
  await sleep(1500);
  const fr = page.frame({ url: dentro });
  console.log('ESITO riquadro-bolla', await incolla(app, page, fr, 'bolla-586'));
});

test('pagina ingrandita al 125% con lo zoom di Filo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>Zoom125</title><body>${CAMPO}</body>`);
  const url = page.url();
  await app.evaluate(({ webContents }, u) => { const w = webContents.getAllWebContents().find((x) => x.getURL() === u); w.setZoomFactor(1.25); }, url);
  await sleep(800);
  console.log('ESITO zoom-filo-125', await incolla(app, page, page, 'zoom125-586'));
});

test('zoom cambiato a menu aperto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>ZoomAperto</title><body>${CAMPO}</body>`);
  const url = page.url();
  await app.evaluate(({ clipboard }) => clipboard.writeText('zoomaperto-586'));
  await page.locator('#c').click({ button: 'right' });
  await page.locator('.sn-menu .sn-menu-paste-main').first().waitFor({ state: 'visible' });
  await sleep(400);
  await app.evaluate(({ webContents }, u) => { const w = webContents.getAllWebContents().find((x) => x.getURL() === u); w.setZoomFactor(1.25); }, url);
  await sleep(800);
  const aperto = await page.locator('.sn-menu').count();
  if (!aperto) { console.log('ESITO zoom-aperto: il menu si chiude'); return; }
  const bb = await page.locator('.sn-menu .sn-menu-paste-main').first().boundingBox();
  await page.mouse.move(bb.x + 10, bb.y + bb.height / 2, { steps: 3 });
  await sleep(200);
  await page.mouse.down(); await page.mouse.up();
  const ok = await expect.poll(() => page.locator('#c').inputValue(), { timeout: 3000 }).toBe('zoomaperto-586').then(() => true, () => false);
  console.log('ESITO zoom-aperto', ok ? 'incollato' : 'non incollato');
});

test('aspetto: etichetta e cronologia dentro il menu', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima voce'));
  const page = await testServer.openReady(openTab, `<!doctype html><title>Aspetto</title><body style="background:#fff">${CAMPO}</body>`);
  await page.locator('#c').click({ button: 'right' });
  await page.locator('.sn-menu .sn-menu-paste-main').first().click();
  await app.evaluate(({ clipboard }) => clipboard.writeText('seconda voce'));
  await page.locator('#c').click({ button: 'right' });
  await sleep(500);
  await page.locator('.sn-menu-paste-arrow').first().hover();
  await sleep(900);
  await page.screenshot({ path: 'tests/.shots/586-giro18-cronologia.png' });
  await page.mouse.move(5, 5);
  await page.keyboard.press('Escape');
  await page.locator('#c').click({ button: 'right' });
  await sleep(500);
  const bb = await page.locator('.sn-menu-row-btn[data-sn-icon-id="newTab"]').first().boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 4 });
  await sleep(1200);
  await page.screenshot({ path: 'tests/.shots/586-giro18-etichetta.png' });
});

test('schermo intero della pagina', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>Intero</title><body>
  <div id="box" style="background:#eee"><button id="b" onclick="document.getElementById('box').requestFullscreen()">intero</button>${CAMPO}</div></body>`);
  await page.locator('#b').click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await sleep(1200);
  console.log('ESITO schermo-intero', await incolla(app, page, page, 'intero-586'));
});
