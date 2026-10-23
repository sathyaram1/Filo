import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { riquadroDelSegno } from '../../helpers/segniDelCorrettore.mjs';

async function prepara(app) {
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
}
async function apri(app, openTab, testServer, html) {
  await prepara(app);
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}
const ocra = (page) => page.locator('.sn-spell-overlay .sn-suggerimento');
const errore = (page) => page.locator('.sn-spell-overlay .sn-errore');
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
const riga = (page) => page.evaluate(() => {
  const r = document.getElementById('f').getBoundingClientRect();
  return { x: Math.round(r.left) + 5, y: Math.round(r.top) + 5, width: Math.round(r.width) - 10, height: 34 };
});
const TA = '<textarea id="f" spellcheck="true" lang="it" style="display:block;width:700px;height:100px;font:22px sans-serif"></textarea>';

async function spiegazione(page) {
  const b = await riquadroDelSegno(ocra(page).first());
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const menu = menuDi(page).pannelli;
  await expect(menu).toBeVisible({ timeout: 5000 });
  const s = await menu.locator('.sn-menu-segno').innerText();
  const c = await menu.locator('.sn-menu-correction').allInnerTexts();
  await page.keyboard.press('Escape');
  return { s, c };
}

for (const [nome, sopra] of [
  ['fondata nel 1999', '<p>Trattoria da Mario, fondata nel 1999, cucina di casa.</p>'],
  ['dal lontano 1999', '<p>Cucina di casa dal lontano 1999.</p>'],
  ['est. 1999', '<p>Trattoria da Mario — est. 1999</p>'],
  ['articolo del 2023', '<article><h1>Le castagne</h1><p>Pubblicato il 3 marzo 2023</p><p>Testo.</p></article><h3>Lascia un commento</h3>'],
  ['menu autunno 2023', '<h2>Menu autunno 2023</h2>'],
]) {
  test(`anno ${nome}`, async ({ app, openTab, testServer }) => {
    const html = `<!doctype html><meta charset="utf-8"><title>Prenota</title><body style="margin:0;padding:20px;font:16px sans-serif"><main>${sopra}<h2>Prenota</h2>${TA}</main></body>`;
    const page = await apri(app, openTab, testServer, html);
    await page.locator('#f').click();
    await page.keyboard.type('vorrei un tavolo per giovedì 9 ottobre perchè siamo in 4');
    await expect(errore(page)).toHaveText(['perchè'], { timeout: 5000 });
    await page.waitForTimeout(500);
    const n = await ocra(page).count();
    console.log(nome, 'ocra', n, n ? JSON.stringify(await spiegazione(page)) : '');
  });
}

for (const [nome, velo] of [
  ['grana', '<div style="position:fixed;inset:0;z-index:9999;pointer-events:none;opacity:0.05;background-image:linear-gradient(45deg,#000 25%,transparent 25%)"></div>'],
  ['vignetta', '<div style="position:fixed;inset:0;z-index:9999;pointer-events:none;background:radial-gradient(ellipse at center,transparent 60%,rgba(0,0,0,.4))"></div>'],
]) {
  test(`velo ${nome}: segni visibili?`, async ({ app, openTab, testServer }) => {
    const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif">${velo}<main style="padding:40px 20px">${TA}</main></body>`;
    const page = await apri(app, openTab, testServer, html);
    await page.locator('#f').click();
    await page.keyboard.type('perchè martedì 9 ottobre 2024');
    await expect(errore(page)).toHaveText(['perchè'], { timeout: 5000 });
    await page.waitForTimeout(2500);
    await page.keyboard.type(' ');
    await page.waitForTimeout(800);
    console.log(nome, 'caldi', await caldi(app, page, await riga(page)));
    await page.screenshot({ path: `tests/.shots/sonda-${nome}.png` }).catch(() => {});
  });
}

test('sticky header', async ({ app, openTab, testServer }) => {
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif;background:#fff">
<header style="position:sticky;top:0;height:90px;background:#3c3c3c;z-index:5"></header>
<main style="padding:30px 20px 2000px">${TA}</main></body>`;
  const page = await apri(app, openTab, testServer, html);
  await page.locator('#f').click();
  await page.keyboard.type('perchè martedì 9 ottobre 2024');
  await expect(errore(page)).toHaveText(['perchè'], { timeout: 5000 });
  await page.evaluate(() => window.scrollBy(0, document.getElementById('f').getBoundingClientRect().top - 30));
  await page.waitForTimeout(800);
  console.log('sticky caldi barra', await caldi(app, page, { x: 0, y: 0, width: 800, height: 90 }));
});

test('scrivi mentre il campo è già sotto la barra', async ({ app, openTab, testServer }) => {
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif;background:#fff">
<header style="position:fixed;top:0;left:0;right:0;height:90px;background:#3c3c3c;z-index:5"></header>
<main style="padding:120px 20px 2000px"><textarea id="f" spellcheck="true" lang="it" style="display:block;width:700px;height:200px;font:22px sans-serif"></textarea></main></body>`;
  const page = await apri(app, openTab, testServer, html);
  await page.locator('#f').click();
  await page.evaluate(() => window.scrollBy(0, document.getElementById('f').getBoundingClientRect().top - 30));
  await page.waitForTimeout(300);
  await page.keyboard.type('perchè martedì 9 ottobre 2024\n\n\n\nciao');
  await expect(errore(page)).toHaveText(['perchè'], { timeout: 5000 });
  await page.waitForTimeout(800);
  console.log('dopo caldi barra', await caldi(app, page, { x: 0, y: 0, width: 800, height: 90 }));
  // la pagina scorre con lo scroll animato
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo({ top: document.getElementById('f').getBoundingClientRect().top + window.scrollY - 30, behavior: 'smooth' }));
  let massimo = 0;
  for (let i = 0; i < 12; i++) { massimo = Math.max(massimo, await caldi(app, page, { x: 0, y: 0, width: 800, height: 90 })); await page.waitForTimeout(50); }
  console.log('smooth massimo caldi barra', massimo);
});
