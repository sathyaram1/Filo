// Esplorazione del giro 3 di #1054: strade del menu di oggi ripetute con lo strato acceso.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function pronto(app) {
  await paginaDelloStrato(app);
  await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
}

async function apriPagina(openTab, testServer, html, opts) {
  const page = await testServer.openReady(openTab, html, opts);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

async function fornitoreFinto(app, testo) {
  await app.evaluate(async (_, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const finto = async ({ messages }) => {
      const s = JSON.stringify(messages);
      if (s.includes('ha selezionato un testo')) return { text: t, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
      return { text: 'ok', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, testo);
}

async function selezionaEApri(page, sel) {
  const p = await page.evaluate((s) => {
    const t = document.querySelector(s).firstChild;
    const r = document.createRange();
    r.setStart(t, 3);
    r.setEnd(t, 9);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, sel);
  await page.mouse.click(p.x, p.y, { button: 'right' });
}

const schede = (shell) => shell.evaluate(() => document.querySelectorAll('.tab').length);

test.describe('acceso', () => {
  test.use({ stratoDelMenu: true });

  test('un collegamento scritto nella spiegazione si apre', async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    await pronto(app);
    const dest = testServer.html('<!doctype html><title>Destinazione</title><p>ok</p>');
    await fornitoreFinto(app, `Vedi [la fonte](${dest}) per saperne di più.`);
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="font:18px sans-serif;padding:40px">
      <p id="testo">Il fotone è la particella elementare della luce.</p></body>`, { pubblico: true });
    await selezionaEApri(page, '#testo');
    const menu = menuDi(page);
    const sezione = menu.locator('.sn-menu-inline-explain');
    await expect(sezione).toContainText('la fonte', { timeout: 8000 });
    const prima = await schede(shell);
    await sezione.locator('a', { hasText: 'la fonte' }).click();
    await expect.poll(() => schede(shell), { timeout: 8000 }).toBeGreaterThan(prima);
  });

  test('un\'icona trascinata dalla barra laterale entra nel menu aperto', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await pronto(app);
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:0;padding:40px;height:1400px">
      <p id="p">Clic destro qui.</p></body>`);
    const barra = await barraPage(app);
    const mossa = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: 'screenshot', target: 'bar' }, {}));
    expect(mossa && mossa.ok, JSON.stringify(mossa)).toBe(true);
    await expect.poll(async () => (await statoBarra(app)).bar).toContain('screenshot');
    await page.locator('#p').click({ button: 'right' });
    const menu = menuDi(page);
    const riga = menu.locator('.sn-menu .sn-menu-row[data-sn-drop-target="primary"]').first();
    await expect(riga).toBeVisible();
    await comandaBarra(app, 'clic');
    await pannelloFermo(barra);
    expect((await statoDelloStrato(app)).aperto, 'il menu si è chiuso aprendo la barra').toBe(true);
    const src = await barra.locator('#nav .ico[data-id="screenshot"]').boundingBox();
    const dst = await riga.boundingBox();
    const s = await statoBarra(app);
    const alto = s.bounds.y - s.alto;
    await barra.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await barra.mouse.down();
    await barra.mouse.move(src.x + 30, src.y + 10, { steps: 3 });
    await barra.mouse.move(dst.x + dst.width - 20, dst.y + dst.height / 2 - alto, { steps: 10 });
    await barra.mouse.up();
    await expect.poll(async () => (await statoBarra(app)).bar, { timeout: 5000 }).not.toContain('screenshot');
  });

  test('Incolla in un editor ricco dentro un riquadro della stessa pagina', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await pronto(app);
    await app.evaluate(({ clipboard }) => clipboard.writeText('INCOLLATO'));
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="margin:0">
      <iframe id="f" style="position:absolute;left:20px;top:20px;width:500px;height:200px;border:1px solid #888"
        srcdoc="<body style='margin:0'><div id='ed' contenteditable='true' style='width:400px;height:120px;font:20px monospace'>uno tre</div></body>"></iframe></body>`);
    const f = page.frameLocator('#f');
    await expect(f.locator('#ed')).toBeVisible();
    const box = await page.locator('#f').boundingBox();
    // dopo «uno »
    await page.mouse.click(box.x + 1 + 4 * 12 + 2, box.y + 1 + 12);
    await page.mouse.click(box.x + 1 + 4 * 12 + 2, box.y + 1 + 12, { button: 'right' });
    await expect.poll(async () => (await statoDelloStrato(app))?.aperto, { timeout: 5000 }).toBe(true);
    await menuDi(page).locator('.sn-menu-paste-main').click();
    await expect(f.locator('#ed')).toContainText('INCOLLATO', { timeout: 5000 });
    const frame = page.frames().find((fr) => fr !== page.mainFrame());
    expect(await frame.evaluate(() => document.hasFocus() && document.activeElement && document.activeElement.id)).toBe('ed');
  });

  test('tempo del tasto destro, acceso', async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    await pronto(app);
    const page = await apriPagina(openTab, testServer, '<!doctype html><body style="margin:0;height:100vh"><p style="margin:60px">pagina</p></body>');
    const tempi = [];
    for (let i = 0; i < 7; i++) {
      const t0 = Date.now();
      await page.mouse.click(200 + i * 10, 200, { button: 'right' });
      await expect(menuDi(page).principale).toBeVisible({ timeout: 5000 });
      tempi.push(Date.now() - t0);
      await page.keyboard.press('Escape');
      await expect.poll(async () => (await statoDelloStrato(app)).aperto).toBe(false);
      await pausa(200);
    }
    console.log('ACCESO', JSON.stringify(tempi), 'mediana', [...tempi].sort((a, b) => a - b)[3]);
  });
});

test.describe('spento', () => {
  test('tempo del tasto destro, spento', async ({ openTab, testServer }) => {
    test.setTimeout(90_000);
    const page = await apriPagina(openTab, testServer, '<!doctype html><body style="margin:0;height:100vh"><p style="margin:60px">pagina</p></body>');
    const tempi = [];
    for (let i = 0; i < 7; i++) {
      const t0 = Date.now();
      await page.mouse.click(200 + i * 10, 200, { button: 'right' });
      await expect(menuDi(page).principale).toBeVisible({ timeout: 5000 });
      tempi.push(Date.now() - t0);
      await page.keyboard.press('Escape');
      await expect(menuDi(page).principale).toHaveCount(0);
      await pausa(200);
    }
    console.log('SPENTO', JSON.stringify(tempi), 'mediana', [...tempi].sort((a, b) => a - b)[3]);
  });

  test('un collegamento scritto nella spiegazione si apre, spento', async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const dest = testServer.html('<!doctype html><title>Destinazione</title><p>ok</p>');
    await fornitoreFinto(app, `Vedi [la fonte](${dest}) per saperne di più.`);
    const page = await apriPagina(openTab, testServer, `<!doctype html><body style="font:18px sans-serif;padding:40px">
      <p id="testo">Il fotone è la particella elementare della luce.</p></body>`, { pubblico: true });
    await selezionaEApri(page, '#testo');
    const menu = menuDi(page);
    const sezione = menu.locator('.sn-menu-inline-explain');
    await expect(sezione).toContainText('la fonte', { timeout: 8000 });
    const prima = await schede(shell);
    await sezione.locator('a', { hasText: 'la fonte' }).click();
    await expect.poll(() => schede(shell), { timeout: 8000 }).toBeGreaterThan(prima);
  });
});
