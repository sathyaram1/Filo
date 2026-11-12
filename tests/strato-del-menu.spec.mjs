// #1053 — lo strato del menu del tasto destro: una vista di Filo sopra la scheda, fuori dal documento del sito, che si
// apre nel punto del tasto destro (anche con la pagina ingrandita e dentro un riquadro) e si chiude da sola.
// Spento di serie: qui lo accende `stratoDelMenu`. Regole: patterns/il-menu-del-tasto-destro-sta-in-uno-strato-sopra-la-scheda.md

import { test, expect } from './fixtures/electron.mjs';
import { paginaDelloStrato, statoDelloStrato } from './helpers/menuContestuale.mjs';

// La pagina del sito tiene i mousedown che riceve (il contextmenu glielo nasconde Filo) e un riquadro di un altro sito.
const REGISTRA = `<script>
  window.visti = [];
  addEventListener('mousedown', (e) => visti.push({ x: e.clientX, y: e.clientY, tasto: e.button, id: e.target.id }), true);
</script>`;

async function apriSito(openTab, testServer) {
  const dentro = testServer.html(`<!doctype html><html><body style="margin:0">
    <div id="interno" style="position:absolute;left:40px;top:30px;width:120px;height:60px;background:#dde">dentro</div>
    ${REGISTRA}</body></html>`).replace('127.0.0.1', 'localhost');
  const page = await openTab(testServer.html(`<!doctype html><html><body style="margin:0">
    <div id="bersaglio" style="position:absolute;left:200px;top:120px;width:120px;height:60px;background:#eed">bersaglio</div>
    <iframe id="riquadro" src="${dentro}" style="position:absolute;left:60px;top:260px;width:300px;height:160px;border:0"></iframe>
    ${REGISTRA}</body></html>`));
  await expect.poll(() => page.frames().length).toBe(2);
  const riquadro = page.frames().find((f) => f !== page.mainFrame());
  await riquadro.waitForLoadState('domcontentloaded');
  await expect(riquadro.locator('#interno')).toBeVisible();
  return { page, riquadro };
}

// Un gesto vero nella vista indicata (px della vista): passa dal suo renderer come quello dell'utente.
async function gesto(app, chi, eventi) {
  await app.evaluate(({ BrowserWindow }, { chi, eventi }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = chi === 'strato' ? tm.strato.vista.webContents : tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    for (const e of eventi) wc.sendInputEvent(e);
  }, { chi, eventi });
}

// Il tasto destro dell'utente su un punto della pagina (px CSS del documento): passa dallo smistamento di Chromium, che
// lo porta anche dentro il riquadro di un altro sito. Un sendInputEvent andrebbe sempre al documento principale.
const clicDestro = (page, p) => page.mouse.click(p.css.x, p.css.y, { button: 'right' });

const zoom = (app, f) => app.evaluate(({ BrowserWindow }, f) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  tm.tabs.find((t) => t.id === tm.activeId).view.webContents.setZoomFactor(f);
}, f);

const areaScheda = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.find((t) => t.id === tm.activeId).view.getBounds();
});

// Centro di un elemento: in px CSS del documento della scheda, e in px della scheda (quello che vede l'utente, zoom compreso).
async function centro(frame, sel, f, scarto = { x: 0, y: 0 }) {
  const r = await frame.locator(sel).evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  const css = { x: Math.round(scarto.x + r.x), y: Math.round(scarto.y + r.y) };
  return { css, x: Math.round(css.x * f), y: Math.round(css.y * f) };
}

async function apertoIn(app, strato, punto) {
  await expect.poll(async () => (await statoDelloStrato(app))?.aperto).toBe(true);
  const s = await statoDelloStrato(app);
  expect(Math.abs(s.punto.x - punto.x), `x dello strato ${s.punto.x}, clic a ${punto.x}`).toBeLessThanOrEqual(1);
  expect(Math.abs(s.punto.y - punto.y), `y dello strato ${s.punto.y}, clic a ${punto.y}`).toBeLessThanOrEqual(1);
  // La vista copre proprio la scheda, sta sopra tutte le altre e si vede; il punto nella sua pagina è lo stesso.
  expect(s.bounds).toEqual(await areaScheda(app));
  expect(s.visibile && s.inCima).toBe(true);
  await expect.poll(() => strato.locator('#ancora').evaluate((a) => (a.hidden ? null : { x: Math.round(a.getBoundingClientRect().x), y: Math.round(a.getBoundingClientRect().y) })))
    .toEqual(s.punto);
  return s;
}

async function chiuso(app) {
  await expect.poll(async () => { const s = await statoDelloStrato(app); return s && !s.aperto && !s.visibile; }).toBe(true);
}

test.describe('strato acceso', () => {
  test.use({ stratoDelMenu: true });

  test('nasce una volta, pronto e nascosto, e si apre nel punto del tasto destro anche con lo zoom e nel riquadro', async ({ app, openTab, testServer }) => {
    const { page, riquadro } = await apriSito(openTab, testServer);
    const strato = await paginaDelloStrato(app);
    await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
    const prima = await statoDelloStrato(app);
    expect(prima.aperto || prima.visibile).toBe(false);

    const base = await page.evaluate(() => window.devicePixelRatio);
    for (const f of [1, 1.5, 0.8]) {
      await zoom(app, f);
      await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(base * f, 2);
      // Nel documento della scheda.
      const p = await centro(page, '#bersaglio', f);
      await page.evaluate(() => { window.visti = []; });
      await clicDestro(page, p);
      const s = await apertoIn(app, strato, p);
      // Il punto dello strato indica davvero quello che l'utente ha cliccato.
      const visto = (await page.evaluate(() => window.visti)).find((v) => v.tasto === 2);
      expect(visto.id).toBe('bersaglio');
      expect(Math.abs(visto.x * f - s.punto.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(visto.y * f - s.punto.y)).toBeLessThanOrEqual(1);
      await gesto(app, 'scheda', [{ type: 'keyDown', keyCode: 'Escape' }, { type: 'keyUp', keyCode: 'Escape' }]);
      await chiuso(app);

      // Dentro il riquadro di un altro sito.
      const ofs = await page.locator('#riquadro').evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y }; });
      const q = await centro(riquadro, '#interno', f, ofs);
      await riquadro.evaluate(() => { window.visti = []; });
      await clicDestro(page, q);
      const t = await apertoIn(app, strato, q);
      // Il clic è arrivato al riquadro, e il suo punto (px CSS del riquadro) è quello dello strato.
      const dentro = (await riquadro.evaluate(() => window.visti)).find((v) => v.tasto === 2);
      expect(dentro, 'il riquadro ha ricevuto il tasto destro').toBeTruthy();
      expect(Math.abs((ofs.x + dentro.x) * f - t.punto.x)).toBeLessThanOrEqual(1);
      expect(Math.abs((ofs.y + dentro.y) * f - t.punto.y)).toBeLessThanOrEqual(1);
      await gesto(app, 'scheda', [{ type: 'keyDown', keyCode: 'Escape' }, { type: 'keyUp', keyCode: 'Escape' }]);
      await chiuso(app);
    }
    // Sempre la stessa vista: nessuna nuova a ogni apertura.
    expect((await statoDelloStrato(app)).vista).toBe(prima.vista);
    expect(app.windows().filter((w) => w.url().startsWith('filo://menu/'))).toHaveLength(1);
  });

  test('il sito non lo vede né lo tocca, e il clic fuori chiude senza arrivare alla pagina', async ({ app, openTab, testServer }) => {
    const { page } = await apriSito(openTab, testServer);
    await paginaDelloStrato(app);
    await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
    const p = await centro(page, '#bersaglio', 1);
    await clicDestro(page, p);
    await expect.poll(async () => (await statoDelloStrato(app))?.aperto).toBe(true);

    // Lo script della pagina cerca lo strato: nel suo documento non c'è, e sotto il punto trova il suo elemento.
    const visto = await page.evaluate(({ x, y }) => {
      const nodi = [];
      (function giro(radice) {
        for (const el of radice.querySelectorAll('*')) { nodi.push(el); if (el.shadowRoot) giro(el.shadowRoot); }
      })(document);
      return {
        traccia: nodi.some((el) => el.id === 'ancora' || /filo:\/\/menu/.test(el.outerHTML.slice(0, 2000))),
        riquadri: window.frames.length,
        // Il menu di oggi, ancora nella pagina, può stare sopra il punto: sotto c'è comunque l'elemento del sito.
        sotto: document.elementsFromPoint(x, y).some((el) => el.id === 'bersaglio'),
        inCima: window.top === window,
      };
    }, p.css);
    expect(visto).toEqual({ traccia: false, riquadri: 1, sotto: true, inCima: true });

    // Un clic fuori dal punto: lo strato si chiude, la pagina non riceve niente.
    await page.evaluate(() => { window.visti = []; });
    const fuori = { x: p.x - 150, y: p.y + 20 };
    await gesto(app, 'strato', [
      { type: 'mouseMove', ...fuori },
      { type: 'mouseDown', ...fuori, button: 'left', clickCount: 1 },
      { type: 'mouseUp', ...fuori, button: 'left', clickCount: 1 },
    ]);
    await chiuso(app);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.visti)).toEqual([]);
    // La tastiera non resta allo strato nascosto.
    expect((await statoDelloStrato(app)).tastiera).toBe(false);
  });

  test('si chiude cambiando scheda, navigando, chiudendo la scheda, con lo schermo intero e con Esc dallo strato', async ({ app, shell, openTab, testServer }) => {
    const { page } = await apriSito(openTab, testServer);
    await paginaDelloStrato(app);
    await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
    const p = await centro(page, '#bersaglio', 1);
    const apri = async () => {
      await clicDestro(page, p);
      await expect.poll(async () => (await statoDelloStrato(app))?.aperto).toBe(true);
    };

    // Un'altra scheda davanti.
    await apri();
    const primo = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activeId);
    await openTab(testServer.html('<p>altra</p>'));
    await chiuso(app);
    await shell.evaluate((id) => window.filoShell.tabs.activate(id), primo);
    await expect.poll(() => areaScheda(app).then((b) => b.width > 0)).toBe(true);

    // Esc con la tastiera nello strato.
    await apri();
    await gesto(app, 'strato', [{ type: 'keyDown', keyCode: 'Escape' }, { type: 'keyUp', keyCode: 'Escape' }]);
    await chiuso(app);

    // Lo schermo intero.
    await apri();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true));
    await chiuso(app);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(false));

    // La scheda che naviga.
    await expect.poll(() => areaScheda(app).then((b) => b.y > 0)).toBe(true);
    await apri();
    const altra = testServer.html(`<!doctype html><html><body style="margin:0">
      <div id="bersaglio" style="position:absolute;left:200px;top:120px;width:120px;height:60px">di nuovo</div></body></html>`);
    await page.evaluate((u) => { location.href = u; }, altra);
    await chiuso(app);

    // La scheda chiusa.
    await page.waitForURL(altra);
    await apri();
    await shell.evaluate((id) => window.filoShell.tabs.close(id), primo);
    await chiuso(app);
  });
});

test('spento di serie: nessuno strato, e il tasto destro non lo apre', async ({ app, openTab, testServer }) => {
  const { page } = await apriSito(openTab, testServer);
  const p = await centro(page, '#bersaglio', 1);
  await clicDestro(page, p);
  await page.waitForTimeout(500);
  const s = await statoDelloStrato(app);
  expect(s.acceso).toBe(false);
  expect(s.vista).toBe(null);
  expect(app.windows().some((w) => w.url().startsWith('filo://menu/'))).toBe(false);
});
