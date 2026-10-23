// #1115.2 — i segni del correttore si vedono solo dove si vede il campo: quando il campo passa sotto un'intestazione
// fissa, o esce dalla colonna che scorre, i puntini ocra e l'onda degli errori restano sotto anche loro. Si guarda quello
// che Electron disegna davvero: sull'intestazione grigia non deve restare nessun pixel caldo dei segni.

import { test, expect } from './fixtures/electron.mjs';

const CE = '<div id="f" contenteditable="true" spellcheck="true" lang="it" style="width:700px;min-height:60px;border:1px solid #999;font:22px sans-serif"></div>';
const TA = '<textarea id="f" spellcheck="true" lang="it" style="display:block;width:700px;height:60px;font:22px sans-serif"></textarea>';
const SFONDO = '#3c3c3c';

const CON_INTESTAZIONE = (campo) => `<!doctype html><meta charset="utf-8">
<body style="margin:0;font:16px sans-serif;background:#fff">
<header id="barra" style="position:fixed;top:0;left:0;right:0;height:90px;background:${SFONDO};z-index:5"></header>
<main style="padding:120px 20px 2000px">${campo}</main>
</body>`;

const IN_COLONNA = (campo) => `<!doctype html><meta charset="utf-8">
<body style="margin:0;font:16px sans-serif;background:#fff;height:100vh;display:flex;flex-direction:column">
<header id="barra" style="flex:none;height:90px;background:${SFONDO}"></header>
<div id="colonna" style="flex:1;overflow:auto;padding:30px 20px"><div style="padding-bottom:2000px">${campo}</div></div>
</body>`;

async function apri(app, openTab, testServer, html) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
    });
    const finto = async () => ({ text: '[][][][nessuno]', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#f').click();
  // Due segni senza modello: «perchè» è un errore sicuro, e il 9 ottobre 2024 era mercoledì.
  await page.keyboard.type('perchè martedì 9 ottobre 2024');
  await expect(page.locator('.sn-spell-overlay .sn-errore')).toHaveText(['perchè'], { timeout: 5000 });
  await expect(page.locator('.sn-spell-overlay .sn-suggerimento')).toHaveText(['martedì 9 ottobre 2024'], { timeout: 5000 });
  return page;
}

// I pixel caldi (i segni: mattone e ocra) in un rettangolo della scheda; l'intestazione e la pagina sono grigie e bianche.
function caldi(app, page, rect) {
  return app.evaluate(async ({ BrowserWindow }, { u, rect }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const tab = (win._filoTabs?.tabs || []).find((t) => { try { return t.view?.webContents?.getURL() === u; } catch (_) { return false; } });
      if (!tab) continue;
      const b = (await tab.view.webContents.capturePage(rect)).toBitmap();
      let n = 0;
      for (let i = 0; i + 2 < b.length; i += 4) if (b[i + 2] - b[i] > 50) n++;
      return n;
    }
    return null;
  }, { u: page.url(), rect });
}

// La prima riga del campo, dentro il bordo: l'anello del fuoco è caldo anche lui.
const riga = (page) => page.evaluate(() => {
  const r = document.getElementById('f').getBoundingClientRect();
  return { x: Math.round(r.left) + 5, y: Math.round(r.top) + 5, width: Math.round(r.width) - 10, height: 34 };
});
const BARRA = { x: 0, y: 0, width: 800, height: 90 };

test('un menu a tendina della pagina sopra una parte del campo: lì i segni non si vedono, sul resto sì', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif;background:#fff">
    <main style="padding:40px 20px;position:relative">${TA}
    <ul id="tendina" style="display:none;position:absolute;left:20px;top:40px;width:110px;height:140px;margin:0;padding:0;background:${SFONDO};list-style:none"><li>&nbsp;</li></ul>
    </main></body>`;
  const page = await apri(app, openTab, testServer, html);
  const tendina = await page.evaluate(() => {
    const t = document.getElementById('tendina');
    t.style.display = 'block';
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  });
  await expect.poll(() => caldi(app, page, tendina), { timeout: 3000 }).toBe(0);
  const resto = await riga(page);
  expect(await caldi(app, page, { ...resto, x: tendina.x + tendina.width + 4, width: resto.width - tendina.width - 8 }),
    'fuori dalla tendina i segni restano').toBeGreaterThan(20);
  await page.screenshot({ path: 'tests/.shots/1115-2-tendina.png' }).catch(() => {});

  // La tendina si chiude: tornano anche i segni che copriva.
  await page.evaluate(() => { document.getElementById('tendina').style.display = 'none'; });
  await expect.poll(() => caldi(app, page, { ...tendina, height: 40 }), { timeout: 3000 }).toBeGreaterThan(5);
});

test('un campo posato fuori da un riquadro che taglia ma non è il suo contenitore: i segni si vedono', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif;background:#fff">
    <div style="overflow:hidden;width:200px;height:30px;margin:20px">
      <div style="position:absolute;left:20px;top:150px">${TA}</div>
    </div></body>`;
  const page = await apri(app, openTab, testServer, html);
  await page.waitForTimeout(300);
  expect(await caldi(app, page, await riga(page))).toBeGreaterThan(20);
});

for (const [nome, campo] of [['casella di testo', TA], ['campo modificabile', CE]]) {
  test(`${nome} sotto un'intestazione fissa: i segni restano sotto con la parola`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await apri(app, openTab, testServer, CON_INTESTAZIONE(campo));
    expect(await caldi(app, page, await riga(page)), 'i segni si vedono sul campo').toBeGreaterThan(20);
    expect(await caldi(app, page, BARRA)).toBe(0);

    // La pagina scorre e la riga scritta passa sotto l'intestazione.
    await page.evaluate(() => window.scrollBy(0, document.getElementById('f').getBoundingClientRect().top - 30));
    await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('f').getBoundingClientRect().top))).toBe(30);
    await expect.poll(() => caldi(app, page, BARRA), { timeout: 3000 }).toBe(0);
    await page.waitForTimeout(300);
    expect(await caldi(app, page, BARRA), 'nessun segno sopra l\'intestazione').toBe(0);
    await page.screenshot({ path: `tests/.shots/1115-2-intestazione-${campo === TA ? 'casella' : 'modificabile'}.png` }).catch(() => {});

    // Torna giù: i segni si rivedono.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => caldi(app, page, await riga(page)), { timeout: 3000 }).toBeGreaterThan(20);
  });

  test(`${nome} in una colonna che scorre: i segni non escono dalla colonna`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await apri(app, openTab, testServer, IN_COLONNA(campo));
    expect(await caldi(app, page, await riga(page)), 'i segni si vedono sul campo').toBeGreaterThan(20);

    // La colonna scorre e il campo sale oltre il suo bordo, dove c'è la barra.
    await page.evaluate(() => { document.getElementById('colonna').scrollTop = 60; });
    await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('f').getBoundingClientRect().top))).toBe(60);
    await expect.poll(() => caldi(app, page, BARRA), { timeout: 3000 }).toBe(0);
    await page.waitForTimeout(300);
    expect(await caldi(app, page, BARRA), 'nessun segno sopra la barra').toBe(0);
    await page.screenshot({ path: `tests/.shots/1115-2-colonna-${campo === TA ? 'casella' : 'modificabile'}.png` }).catch(() => {});
  });
}
