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
    const fr = page.frameLocator('#f');
    await page.waitForFunction(() => document.getElementById('f').contentDocument?.documentElement?.dataset.filoReady === '1', null, { timeout: 8000 });
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
