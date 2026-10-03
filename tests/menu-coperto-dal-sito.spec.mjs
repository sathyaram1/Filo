// #589.11 — dopo un tasto destro vero dell'utente su un suo campo, il sito stendeva sul menu di Filo un velo che lascia
// passare il mouse e gli faceva scegliere, senza vederla, una voce della cronologia degli appunti. Un clic su una voce
// conta solo se il browser la vede scoperta. Regola: patterns/un-pezzo-di-filo-in-un-sito-ubbidisce-solo-all-utente.md

import { test, expect } from './fixtures/electron.mjs';
import { statoCronologia, testiCronologia, cronologiaPronta } from './helpers/cronologiaAppunti.mjs';

const SEGRETO = 'pw-Segreta-589-undici';
const MONDO_CONTENT_SCRIPT = 999;

// Lo script del sito: un velo bianco sopra tutto, che il mouse attraversa, steso appena il menu entra nella pagina.
const SITO = `
  window.stendi = (z = 2147483647) => {
    const v = document.createElement('div');
    v.id = 'velo';
    v.style.cssText = 'position:fixed;inset:0;background:#fff;pointer-events:none;font:20px sans-serif;padding:20px;z-index:' + z;
    v.textContent = 'Clicca i quadrati per continuare';
    document.body.appendChild(v);
  };
  window.togli = () => { const v = document.getElementById('velo'); if (v) v.remove(); };
  window.alMenu = (fn) => new MutationObserver((ms, mo) => {
    if (document.querySelector('.sn-menu')) { mo.disconnect(); fn(); }
  }).observe(document.documentElement, { childList: true, subtree: true });
`;

const PAGINA = `<!doctype html><html><body style="padding:40px">
  <input id="campo" style="width:320px;font-size:16px">
  <script>${SITO}</script>
</body></html>`;

// Il mondo isolato dei content script della scheda: lì vivono il menu e la guardia.
function nelMondo(app, page, code) {
  return app.evaluate(async ({ BrowserWindow }, { u, mondo, code }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const tab = (win._filoTabs?.tabs || []).find((t) => {
        try { return t.view?.webContents?.getURL() === u; } catch (_) { return false; }
      });
      if (tab) return tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code }]);
    }
    return null;
  }, { u: page.url(), mondo: MONDO_CONTENT_SCRIPT, code });
}
const statoVoce = (app, page, sel) => nelMondo(app, page,
  `globalThis.SN_VISTO?._test.stato(document.querySelector(${JSON.stringify(sel)})) ?? null`);

async function conCronologia(shell) {
  for (const text of ['un testo qualsiasi', SEGRETO]) {
    await shell.evaluate((t) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text: t } }), text);
  }
}

async function apri(openTab, testServer, html = PAGINA) {
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  return page;
}

async function centro(locator) {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

const avvisoCoperto = (page) => page.locator('.sn-toast', { hasText: 'Il menu era coperto' });

test('sotto il velo del sito la voce della cronologia scelta senza vederla non incolla la password', async ({ app, shell, openTab, testServer }) => {
  await conCronologia(shell);
  const page = await apri(openTab, testServer);
  await page.evaluate(() => window.alMenu(() => window.stendi()));

  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('#velo')).toBeVisible();
  // Il primo quadrato sta sulla freccia di Incolla: la cronologia si apre da sola, sotto il velo.
  const freccia = await centro(page.locator('.sn-menu-paste-arrow'));
  await page.mouse.move(freccia.x, freccia.y, { steps: 4 });
  await expect.poll(() => testiCronologia(app, page)).toContain(SEGRETO);
  await page.waitForTimeout(700);
  const voce = (await statoCronologia(app, page)).voci.find((v) => v.testo === SEGRETO);
  expect(voce.pronta, 'il browser vede la voce coperta dal velo').toBe(false);

  // Il secondo quadrato sta sulla voce: il clic è vero, ma l'utente vedeva solo il velo.
  await page.mouse.move(voce.incolla.x, voce.incolla.y, { steps: 4 });
  await page.mouse.click(voce.incolla.x, voce.incolla.y);
  await expect(avvisoCoperto(page)).toBeVisible();
  expect(await page.locator('#campo').inputValue(), 'la password non arriva al campo del sito').not.toContain(SEGRETO);
  await expect(page.locator('.sn-menu')).toHaveCount(0);

  // Tolto il velo, la stessa strada fatta vedendo il menu incolla come sempre.
  await page.evaluate(() => window.togli());
  await page.locator('#campo').click({ button: 'right' });
  await page.locator('.sn-menu-paste-arrow').hover();
  await expect.poll(() => testiCronologia(app, page)).toContain(SEGRETO);
  const vista = (await cronologiaPronta(app, page)).voci.find((v) => v.testo === SEGRETO);
  await page.mouse.move(vista.incolla.x, vista.incolla.y, { steps: 4 });
  await page.mouse.click(vista.incolla.x, vista.incolla.y);
  await expect(page.locator('#campo')).toHaveValue(SEGRETO);
});

test('sotto il velo non partono nemmeno Incolla e Detta', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await apri(openTab, testServer);

  await page.evaluate(() => window.alMenu(() => window.stendi()));
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('#velo')).toBeVisible();
  await page.waitForTimeout(700);
  await page.locator('.sn-menu-paste-main').click();
  await expect(avvisoCoperto(page)).toBeVisible();
  expect(await page.locator('#campo').inputValue(), 'gli appunti non arrivano al campo del sito').not.toContain(SEGRETO);

  await page.evaluate(() => { window.togli(); window.alMenu(() => window.stendi()); });
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('#velo')).toBeVisible();
  await page.waitForTimeout(700);
  await page.locator('.sn-menu-split-main', { hasText: 'Detta' }).click();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => document.documentElement.innerText), 'il microfono non si accende').not.toMatch(/Ti ascolto|Microfono/);
});

test('un velo tolto mentre la mano arriva sulla voce non lascia passare il clic: prima va visto', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await apri(openTab, testServer);
  // Il sito toglie il velo quando il puntatore arriva su Incolla.
  await page.evaluate(() => window.alMenu(() => {
    window.stendi();
    const via = (e) => { if (e.target.closest && e.target.closest('.sn-menu-paste-main')) { window.togli(); window.removeEventListener('pointerover', via, true); } };
    window.addEventListener('pointerover', via, true);
  }));
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('#velo')).toBeVisible();
  await page.waitForTimeout(700);
  const incolla = await centro(page.locator('.sn-menu-paste-main'));
  await page.mouse.move(incolla.x, incolla.y, { steps: 4 });
  await expect(page.locator('#velo')).toHaveCount(0);
  await expect.poll(() => statoVoce(app, page, '.sn-menu-paste-main')).toBe('visibile');
  await page.mouse.click(incolla.x, incolla.y);
  await expect(avvisoCoperto(page)).toBeVisible();
  expect(await page.locator('#campo').inputValue()).not.toContain(SEGRETO);

  // Lo stesso velo, ma la voce resta scoperta il tempo di vederla: il clic incolla.
  await page.evaluate(() => window.alMenu(() => {
    window.stendi();
    setTimeout(() => window.togli(), 200);
  }));
  await page.locator('#campo').click({ button: 'right' });
  await expect.poll(() => statoVoce(app, page, '.sn-menu-paste-main')).toBe('visibile');
  await page.waitForTimeout(700);
  await page.locator('.sn-menu-paste-main').click();
  await expect(page.locator('#campo')).toHaveValue(SEGRETO);
});

test('un velo che non tocca il menu non ferma niente, e il primo clic sul menu appena aperto vale', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await apri(openTab, testServer, `<!doctype html><html><body style="padding:40px">
    <div style="position:fixed;left:0;right:0;bottom:0;height:60px;background:#fff;pointer-events:none;z-index:2147483647">Banner</div>
    <input id="campo" style="width:320px;font-size:16px">
  </body></html>`);
  await page.locator('#campo').click({ button: 'right' });
  await page.locator('.sn-menu-paste-main').click();
  await expect(page.locator('#campo')).toHaveValue(SEGRETO);
  await expect(avvisoCoperto(page)).toHaveCount(0);
});

test('il foglio di stile del sito non porta il menu sotto il suo velo', async ({ app, openTab, testServer }) => {
  const page = await apri(openTab, testServer, `<!doctype html><html><head>
    <style>.sn-menu { z-index: 1 !important; position: absolute !important; display: contents !important; }</style>
    </head><body style="padding:40px">
    <input id="campo" style="width:320px;font-size:16px">
    <script>${SITO}</script>
  </body></html>`);
  await page.evaluate(() => window.alMenu(() => window.stendi(1000)));
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('#velo')).toBeVisible();
  const menu = page.locator('.sn-menu').first();
  const stile = await menu.evaluate((m) => { const cs = getComputedStyle(m); return [cs.position, cs.zIndex, cs.display]; });
  expect(stile, 'il menu resta fisso e sopra il velo').toEqual(['fixed', '2147483646', 'block']);
  // Lo stesso, se a cambiarlo è lo script del sito.
  await menu.evaluate((m) => { m.style.zIndex = '1'; m.style.position = 'static'; });
  await expect.poll(() => menu.evaluate((m) => getComputedStyle(m).zIndex)).toBe('2147483646');
  await expect.poll(() => statoVoce(app, page, '.sn-menu-paste-main')).toBe('visibile');
});

test('un velo della pagina sopra un riquadro incorporato copre anche il menu aperto lì dentro', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const riquadro = testServer.html(`<!doctype html><html><body style="margin:10px">
    <input id="campo" style="width:240px;font-size:16px"></body></html>`, { pubblico: true });
  const page = await apri(openTab, testServer, `<!doctype html><html><body style="padding:20px">
    <iframe src="${riquadro}" style="width:600px;height:420px;border:0"></iframe>
    <script>${SITO}; window.stendi();</script>
  </body></html>`);
  const delRiquadro = () => page.frames().find((f) => f.url().includes('sito-pubblico.test'));
  await expect.poll(() => !!delRiquadro()).toBe(true);
  const frame = delRiquadro();
  // Nei riquadri i content script si montano al primo gesto: il tasto destro li monta e si rigioca.
  await frame.waitForSelector('#campo');

  await frame.locator('#campo').click({ button: 'right' });
  await expect(frame.locator('.sn-menu-paste-main')).toBeVisible();
  await page.waitForTimeout(700);
  await frame.locator('.sn-menu-paste-main').click();
  await expect(frame.locator('.sn-toast', { hasText: 'Il menu era coperto' })).toBeVisible();
  expect(await frame.locator('#campo').inputValue()).not.toContain(SEGRETO);
});

test('i pezzi di Filo sopra il menu non contano come velo: etichetta delle icone e conferma annullata', async ({ app, shell, openTab, testServer }) => {
  await conCronologia(shell);
  const page = await apri(openTab, testServer);

  // L'etichetta di un'icona scende sulle voci sotto la riga: per il browser restano scoperte.
  await page.locator('#campo').click({ button: 'right' });
  const icona = page.locator('.sn-menu-row-btn[aria-label]').first();
  await icona.hover();
  await expect(page.locator('.sn-tooltip')).toBeVisible();
  await page.waitForTimeout(400);
  const sotto = await nelMondo(app, page, `(() => {
    const t = document.querySelector('.sn-tooltip').getBoundingClientRect();
    return [...document.querySelectorAll('.sn-menu button')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.left < t.right && t.left < r.right && r.top < t.bottom && t.top < r.bottom;
    }).map((b) => SN_VISTO._test.stato(b));
  })()`);
  expect(sotto.length, 'l\'etichetta copre almeno una voce').toBeGreaterThan(0);
  expect(sotto.every((s) => s === 'visibile')).toBe(true);
  await page.keyboard.press('Escape');

  // Svuota → Annulla: la conferma di Filo copriva la cronologia, e chi torna subito su una voce incolla.
  await page.locator('#campo').click({ button: 'right' });
  await page.locator('.sn-menu-paste-arrow').click();
  const stato = await cronologiaPronta(app, page);
  await page.mouse.click(stato.svuota.x, stato.svuota.y);
  await expect(page.locator('.sn-confirm-host')).toBeVisible();
  await expect.poll(async () => (await statoCronologia(app, page)).voci.every((v) => !v.pronta)).toBe(true);
  expect(await nelMondo(app, page, `SN_CONFIRM_UI._test.click('cancel')`)).toBe(true);
  await expect(page.locator('.sn-confirm-host')).toHaveCount(0);
  // Scoperta senza attesa: a coprirla era Filo, non il sito.
  await expect.poll(async () => (await statoCronologia(app, page)).voci.find((v) => v.testo === SEGRETO)?.libera).toBe(true);
  const voce = (await statoCronologia(app, page)).voci.find((v) => v.testo === SEGRETO);
  await page.mouse.move(voce.incolla.x, voce.incolla.y, { steps: 2 });
  await page.mouse.click(voce.incolla.x, voce.incolla.y);
  await expect(page.locator('#campo')).toHaveValue(SEGRETO);
});
