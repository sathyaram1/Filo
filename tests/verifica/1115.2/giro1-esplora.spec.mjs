// Verifica #1115.2 giro 1: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';

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
  return page;
}
const ocra = (page) => page.locator('.sn-spell-overlay .sn-suggerimento');
const errore = (page) => page.locator('.sn-spell-overlay .sn-errore');

test('chat senza main, composer in footer', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const html = `<!doctype html><meta charset="utf-8"><title>WhatsApp</title><body style="margin:0;font:16px sans-serif">
  <div id="app"><div class="lista">
    <div class="msg"><span>Luca</span><div>ti ricordi il matrimonio di Marta, nel 2024?</div><span>10:02</span></div>
  </div>
  <footer><div id="f" contenteditable="true" spellcheck="true" lang="it" style="width:700px;min-height:40px;font:20px sans-serif;border:1px solid #999"></div></footer></div></body>`;
  const page = await apri(app, openTab, testServer, html);
  await page.locator('#f').click();
  await page.keyboard.type('certo, mercoledì 9 ottobre, pioveva perchè era autunno');
  await expect(errore(page)).toHaveText(['perchè'], { timeout: 5000 });
  await page.waitForTimeout(500);
  await expect(ocra(page)).toHaveCount(0);
});

test('modulo di prenotazione con piè di pagina vecchio', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const html = `<!doctype html><meta charset="utf-8"><title>Prenota - Trattoria</title><body style="margin:0;padding:20px;font:16px sans-serif">
  <main><h2>Prenota un tavolo</h2>
  <textarea id="f" spellcheck="true" lang="it" style="display:block;width:700px;height:100px;font:20px sans-serif"></textarea>
  <button>Invia</button></main>
  <footer>Trattoria da Mario, via Roma 3. © 2024 Tutti i diritti riservati.</footer></body>`;
  const page = await apri(app, openTab, testServer, html);
  await page.locator('#f').click();
  await page.keyboard.type('vorrei un tavolo per mercoledì 9 ottobre perchè siamo in 4');
  await expect(errore(page)).toHaveText(['perchè'], { timeout: 5000 });
  await page.waitForTimeout(500);
  await expect(ocra(page), 'la data sbagliata di quest\'anno si segna').toHaveText(['mercoledì 9 ottobre'], { timeout: 3000 });
});

test('modulo con «dal 1998» sopra', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const html = `<!doctype html><meta charset="utf-8"><title>Prenota - Trattoria</title><body style="margin:0;padding:20px;font:16px sans-serif">
  <main><p>Cucina di casa dal 1998.</p><h2>Prenota un tavolo</h2>
  <textarea id="f" spellcheck="true" lang="it" style="display:block;width:700px;height:100px;font:20px sans-serif"></textarea>
  </main></body>`;
  const page = await apri(app, openTab, testServer, html);
  await page.locator('#f').click();
  await page.keyboard.type('vorrei un tavolo per giovedì 9 ottobre perchè siamo in 4');
  await expect(errore(page)).toHaveText(['perchè'], { timeout: 5000 });
  await expect(ocra(page)).toHaveText(['giovedì 9 ottobre'], { timeout: 3000 });
  const corr = await page.evaluate(() => [...document.querySelectorAll('.sn-spell-overlay .sn-suggerimento')].map((s) => s.title || s.dataset.spiegazione || ''));
  console.log('RIGA', JSON.stringify(corr));
});

const SFONDO = '#3c3c3c';
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
const BARRA = { x: 0, y: 0, width: 800, height: 90 };

for (const [nome, header, setup] of [
  ['sticky', `<header style="position:sticky;top:0;height:90px;background:${SFONDO};z-index:5"></header>`, ''],
  ['fixed pointer-events none', `<header style="position:fixed;top:0;left:0;right:0;height:90px;background:${SFONDO};z-index:5;pointer-events:none"></header>`, ''],
  ['shadow dom', `<header style="position:fixed;top:0;left:0;right:0;height:90px;background:${SFONDO};z-index:5"></header>`, 'shadow'],
]) {
  test(`intestazione ${nome}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const campo = '<textarea id="f" spellcheck="true" lang="it" style="display:block;width:700px;height:60px;font:22px sans-serif"></textarea>';
    const corpo = setup === 'shadow'
      ? `<main style="padding:120px 20px 2000px"><div id="host"></div></main><script>document.getElementById('host').attachShadow({mode:'open'}).innerHTML = ${JSON.stringify(campo)};</script>`
      : `<main style="padding:${nome === 'sticky' ? 30 : 120}px 20px 2000px">${campo}</main>`;
    const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif;background:#fff">${header}${corpo}</body>`;
    const page = await apri(app, openTab, testServer, html);
    const f = setup === 'shadow' ? page.locator('#host').locator('#f') : page.locator('#f');
    await f.click();
    await page.keyboard.type('perchè martedì 9 ottobre 2024');
    await expect(page.locator('.sn-spell-overlay .sn-errore')).toHaveText(['perchè'], { timeout: 5000 });
    const top = () => page.evaluate((s) => {
      const el = s ? document.getElementById('host').shadowRoot.getElementById('f') : document.getElementById('f');
      return Math.round(el.getBoundingClientRect().top);
    }, setup === 'shadow');
    await page.evaluate((d) => window.scrollBy(0, d), (await top()) - 30);
    await expect.poll(top).toBe(30);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `tests/.shots/v1115-2-${nome.replace(/ /g, '-')}.png` }).catch(() => {});
    expect(await caldi(app, page, BARRA), 'nessun segno sopra l\'intestazione').toBe(0);
  });
}
