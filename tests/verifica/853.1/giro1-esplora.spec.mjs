// Esplorazione della verifica #853.1, giro 1: la riga per la domanda dopo, con zoom, tema scuro e testi insoliti.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { nelMondoDiFilo, clicca } from '../../helpers/riquadri.mjs';

const RISPOSTA = 'La fotosintesi trasforma la luce in zuccheri.';
const BARRA = 4;
const FRASE = 'La fotosintesi clorofilliana trasforma la luce in zuccheri.';
const PAGINA_WEB = '<!doctype html><html><head><meta charset="utf-8"></head>'
  + `<body style="margin:0;padding:40px;font:16px sans-serif"><p id="bersaglio">${FRASE}</p></body></html>`;

async function preparaModello(app, tema) {
  await app.evaluate(async (_e, [t, tema]) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash', [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      ...(tema ? { theme: tema } : {}),
    });
    globalThis.__origProvV = globalThis.__origProvV || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origProvV,
      complete: async () => ({ text: t, toolCalls: [], reasoningDetails: [], usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta(t); return { text: t, usage: {} }; },
    };
  }, [RISPOSTA, tema]);
}

function misura(app, page) {
  return nelMondoDiFilo(app, page, () => {
    const T = globalThis.SN_FILO_UI && globalThis.SN_FILO_UI._test;
    const trova = (s) => (T ? T.trova(s) : document.querySelector(s));
    const el = trova('.sn-popup-input');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const px = (v) => parseFloat(v) || 0;
    return {
      alto: el.getBoundingClientRect().height,
      altoCss: el.offsetHeight,
      eccesso: el.scrollHeight - el.clientHeight,
      barra: el.offsetWidth - el.clientWidth - px(cs.borderLeftWidth) - px(cs.borderRightWidth),
      overflowY: cs.overflowY,
    };
  });
}

async function apri(app, page) {
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#bersaglio'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.locator('#bersaglio').click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-inline-explain .sn-menu-inline-body')).not.toHaveText(/Spiegazione…/, { timeout: 30_000 });
  await menu.locator('.sn-menu-inline-arrow').click();
  await expect.poll(() => misura(app, page), { timeout: 15_000 }).not.toBeNull();
}

const zoom = (app, f) => app.evaluate(({ BrowserWindow }, f) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  tm.tabs.find((t) => t.id === tm.activeId).view.webContents.setZoomFactor(f);
}, f);

async function righe(app, page, etichetta, esiti) {
  const v = await misura(app, page);
  esiti.push({ etichetta, stato: 'vuota', ...v });
  await clicca(app, page, '.sn-popup-input');
  await page.keyboard.insertText('e in inglese?');
  await page.waitForTimeout(150);
  esiti.push({ etichetta, stato: 'una', ...(await misura(app, page)) });
  await page.keyboard.insertText('\nseconda\nterza');
  await page.waitForTimeout(150);
  esiti.push({ etichetta, stato: 'tre', ...(await misura(app, page)) });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText('ciao 😀 你好 مرحبا 🇮🇹 ẞ');
  await page.waitForTimeout(150);
  esiti.push({ etichetta, stato: 'scritture', ...(await misura(app, page)) });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText('parola '.repeat(40));
  await page.waitForTimeout(150);
  esiti.push({ etichetta, stato: 'lunga-a-capo', ...(await misura(app, page)) });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
  esiti.push({ etichetta, stato: 'svuotata', ...(await misura(app, page)) });
}

test('esplora: zoom prima di aprire', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  await preparaModello(app);
  const page = await testServer.openReady(openTab, PAGINA_WEB);
  const esiti = [];
  for (const z of [0.9, 1.1, 1.25, 1.5]) {
    await zoom(app, z);
    await page.waitForTimeout(300);
    await apri(app, page);
    await righe(app, page, `zoom-prima-${z}`, esiti);
    await page.keyboard.press('Escape');
    await nelMondoDiFilo(app, page, () => { document.querySelectorAll('.sn-popup-close').forEach((b) => b.click()); });
    await page.waitForTimeout(300);
  }
  console.log(JSON.stringify(esiti, null, 1));
  const male = esiti.filter((e) => e.eccesso > 0 || e.barra >= BARRA);
  expect(male).toEqual([]);
});

test('esplora: zoom dopo aprire', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  await preparaModello(app);
  const page = await testServer.openReady(openTab, PAGINA_WEB);
  await apri(app, page);
  const esiti = [];
  for (const z of [1.1, 1.25, 0.9]) {
    await zoom(app, z);
    await page.waitForTimeout(400);
    await righe(app, page, `zoom-dopo-${z}`, esiti);
  }
  console.log(JSON.stringify(esiti, null, 1));
  const male = esiti.filter((e) => e.eccesso > 0 || e.barra >= BARRA);
  expect(male).toEqual([]);
});

test('esplora: scritture insolite e tema scuro, editor e web', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  await preparaModello(app, 'dark');
  const esiti = [];
  const web = await testServer.openReady(openTab, PAGINA_WEB);
  await apri(app, web);
  await web.screenshot({ path: 'tests/.shots/v8531-web-scuro.png' });
  await righe(app, web, 'web-scuro', esiti);
  const ed = await openTab('filo://editor/');
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 15_000 });
  await ed.evaluate((frase) => {
    const p = document.createElement('p');
    p.id = 'bersaglio'; p.textContent = frase;
    p.style.cssText = 'position:fixed;left:40px;top:120px;z-index:2147480000;margin:0;padding:8px;font:16px sans-serif';
    document.body.appendChild(p);
  }, FRASE);
  await apri(app, ed);
  await ed.screenshot({ path: 'tests/.shots/v8531-editor-scuro.png' });
  await righe(app, ed, 'editor-scuro', esiti);
  console.log(JSON.stringify(esiti, null, 1));
  const male = esiti.filter((e) => e.eccesso > 0 || e.barra >= BARRA);
  expect(male).toEqual([]);
});
