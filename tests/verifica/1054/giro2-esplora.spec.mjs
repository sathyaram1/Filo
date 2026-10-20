// #1054 giro 2 — esplorazione del verificatore: il menu nello strato fuori dai casi dello spec del lavoro.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function apriPagina(openTab, testServer, html) {
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

async function pronto(app) {
  await paginaDelloStrato(app);
  await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
}

const chiuso = (app) => expect.poll(async () => { const s = await statoDelloStrato(app); return !!s && !s.aperto && !s.visibile; }).toBe(true);

test.describe('strato acceso', () => {
  test.use({ stratoDelMenu: true });

  test('voci, tempi, copia, riquadro, doppio tasto destro', async ({ app, openTab, testServer }) => {
    test.setTimeout(120_000);
    await pronto(app);
    const dentro = testServer.html(`<!doctype html><body style="margin:0"><a id="l2" href="https://example.com/dentro" style="position:absolute;left:20px;top:20px">nel riquadro</a></body>`).replace('127.0.0.1', 'localhost');
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:0;font:18px sans-serif">
      <p id="testo" style="margin:40px">Una frase da selezionare qui.</p>
      <a id="link" href="https://example.com/a" style="position:absolute;left:400px;top:200px">un collegamento</a>
      <a id="link2" href="https://example.com/b" style="position:absolute;left:400px;top:420px">un altro</a>
      <iframe id="r" src="${dentro}" style="position:absolute;left:40px;top:500px;width:300px;height:120px;border:0"></iframe></body>`);
    const menu = menuDi(page);
    const tempi = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      await page.locator('#link').click({ button: 'right' });
      await expect(menu.principale).toBeVisible({ timeout: 5000 });
      tempi.push(Date.now() - t0);
      await menu.superficie.keyboard.press('Escape');
      await chiuso(app);
    }
    console.log('TEMPI strato', tempi);
    await page.locator('#link').click({ button: 'right' });
    await expect(menu.principale).toBeVisible();
    console.log('VOCI link', await menu.voci.allTextContents());
    console.log('ICONE link', await menu.locator('[data-sn-icon-id]').evaluateAll((els) => els.map((e) => e.dataset.snIconId)));
    // Hover su un'icona: l'etichetta.
    const prima = menu.locator('[data-sn-icon-id]').first();
    await prima.hover();
    await pausa(900);
    console.log('ETICHETTA', await menu.etichetta.count(), await menu.etichetta.allTextContents());
    await menu.superficie.screenshot({ path: 'tests/.shots/v1054-hover.png' });

    // Doppio tasto destro: il secondo, su un altro collegamento, apre lì.
    await page.mouse.click(420, 430, { button: 'right' });
    await pausa(800);
    const s = await statoDelloStrato(app);
    console.log('SECONDO', JSON.stringify(s.punto), s.aperto);
    await menu.voce('Copia URL').click();
    await chiuso(app);
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('https://example.com/b');

    // Selezione e Copia.
    await page.evaluate(() => {
      const t = document.getElementById('testo').firstChild;
      const r = document.createRange();
      r.setStart(t, 4); r.setEnd(t, 9);
      getSelection().removeAllRanges(); getSelection().addRange(r);
    });
    await page.locator('#testo').click({ button: 'right', position: { x: 70, y: 10 } });
    await expect(menu.principale).toBeVisible();
    console.log('VOCI selezione', await menu.voci.allTextContents());
    console.log('ICONE selezione', await menu.locator('[data-sn-icon-id]').evaluateAll((els) => els.map((e) => e.dataset.snIconId)));
    await menu.superficie.screenshot({ path: 'tests/.shots/v1054-selezione.png' });
    const copia = menu.locator('[data-sn-icon-id="copy"]');
    if (await copia.count()) await copia.click();
    else await menu.voce('Copia').first().click();
    await chiuso(app);
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('frase');

    // Riquadro di un altro sito.
    const fr = page.frames().find((f) => f !== page.mainFrame());
    await fr.waitForLoadState('domcontentloaded');
    await page.mouse.click(60, 525, { button: 'right' });
    await expect(menu.principale).toBeVisible();
    console.log('VOCI riquadro', await menu.voci.allTextContents());
    await menu.voce('Copia URL').click();
    await chiuso(app);
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('https://example.com/dentro');
  });

  test('cambio scheda e nuova scheda chiudono', async ({ app, openTab, testServer, shell }) => {
    await pronto(app);
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:0"><a id="link" href="https://example.com/a" style="position:absolute;left:300px;top:200px">un collegamento</a></body>`);
    await page.locator('#link').click({ button: 'right' });
    await expect(menuDi(page).principale).toBeVisible();
    await shell.evaluate(() => window.filoShell.tabs.open('filo://home/'));
    await chiuso(app);
  });
});

test.describe('strato spento', () => {
  test('tempi', async ({ openTab, testServer }) => {
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:0"><a id="link" href="https://example.com/a" style="position:absolute;left:400px;top:200px">un collegamento</a></body>`);
    const menu = menuDi(page);
    const tempi = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      await page.locator('#link').click({ button: 'right' });
      await expect(menu.principale).toBeVisible({ timeout: 5000 });
      tempi.push(Date.now() - t0);
      await page.keyboard.press('Escape');
      await expect(menu.principale).toHaveCount(0);
    }
    console.log('TEMPI spento', tempi);
  });
});
