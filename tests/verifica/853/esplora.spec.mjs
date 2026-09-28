// Esplorazione del verificatore #853: tutte le pagine interne, tema chiaro e
// scuro, link cliccato davvero, Traduci. Stampa ciò che vede.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots/853';
mkdirSync(SHOTS, { recursive: true });

const RISPOSTA = 'Il **grassetto** resta e `codice` pure.\n\n- la [guida](https://example.com/guida) si apre\n- secondo punto con https://example.org/nudo\n\n1. primo\n2. secondo';

async function preparaModello(app, testo, tema) {
  await app.evaluate(async (_e, [t, tema]) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      theme: tema,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.EXPLAIN]: 'deepseek-flash',
        [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash',
        [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__origP = globalThis.__origP || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origP,
      complete: async () => ({ text: t, toolCalls: [], reasoningDetails: [], usage: {} }),
      streamComplete: async ({ onDelta }) => {
        for (let i = 0; i < t.length; i += 7) { onDelta(t.slice(i, i + 7)); await new Promise((r) => setTimeout(r, 15)); }
        return { text: t, usage: {} };
      },
    };
  }, [testo, tema]);
}

async function bersaglio(page) {
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'b853';
    p.textContent = 'La fotosintesi clorofilliana trasforma la luce in zuccheri.';
    p.style.cssText = 'position:fixed;left:40px;top:120px;z-index:2147480000;margin:0;padding:8px;font:16px sans-serif';
    document.body.appendChild(p);
    const r = document.createRange();
    r.selectNodeContents(p);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
}

const PAGINE = [
  ['editor', 'filo://editor/editor.html'],
  ['manage', 'filo://manage/manage.html'],
  ['feedback', 'filo://feedback/feedback.html'],
  ['decks', 'filo://decks/decks.html'],
  ['history', 'filo://history/history.html'],
  ['archive', 'filo://archive/archive.html'],
  ['preferences', 'filo://preferences/preferences.html'],
  ['options', 'filo://options/options.html'],
  ['board', 'filo://board/board.html'],
  ['downloads', 'filo://downloads/downloads.html'],
  ['credits', 'filo://credits/credits.html'],
  ['dashboard', 'filo://dashboard/dashboard.html'],
];

for (const tema of ['light', 'dark']) {
  for (const [nome, url] of PAGINE) {
    test(`esplora ${nome} ${tema}`, async ({ app, openTab }) => {
      test.setTimeout(90_000);
      await preparaModello(app, RISPOSTA, tema);
      const page = await openTab(url);
      const pronta = await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 15_000 }).then(() => true, () => false);
      await page.waitForTimeout(500);
      await bersaglio(page);
      await page.locator('#b853').click({ button: 'right' });
      const menu = page.locator('.sn-menu');
      await expect(menu).toBeVisible();
      const corpo = menu.locator('.sn-menu-inline-explain .sn-menu-inline-body');
      await expect(corpo).not.toHaveText(/Spiegazione…/, { timeout: 30_000 });
      const html = await corpo.innerHTML();
      const voci = await menu.locator('.sn-menu-item').allTextContents();
      const stile = await corpo.evaluate((el) => {
        const s = el.querySelector('strong'); const a = el.querySelector('a'); const li = el.querySelector('li'); const ul = el.querySelector('ul');
        const cs = (x) => x ? getComputedStyle(x) : null;
        return {
          strongW: cs(s)?.fontWeight, aColor: cs(a)?.color, aDeco: cs(a)?.textDecorationLine,
          ulList: cs(ul)?.listStyleType, ulPad: cs(ul)?.paddingLeft, liDisplay: cs(li)?.display,
          bodyColor: cs(el).color, bodyBg: cs(el.closest('.sn-menu')).backgroundColor,
        };
      });
      await page.screenshot({ path: `${SHOTS}/${nome}-${tema}-menu.png` });
      await menu.locator('.sn-menu-inline-arrow').click();
      const riq = page.locator('.sn-popup .sn-popup-body');
      await expect(riq).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 30_000 });
      const htmlRiq = await riq.innerHTML();
      await page.screenshot({ path: `${SHOTS}/${nome}-${tema}-riquadro.png` });
      console.log(JSON.stringify({ nome, tema, pronta, voci, strongMenu: html.includes('<strong>'), linkMenu: /filo-md-link/.test(html), strongRiq: htmlRiq.includes('<strong>'), linkRiq: /filo-md-link/.test(htmlRiq), stile }));
    });
  }
}

test('link cliccato davvero su pagina interna apre una scheda', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModello(app, RISPOSTA, 'light');
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  await bersaglio(page);
  await page.locator('#b853').click({ button: 'right' });
  const corpo = page.locator('.sn-menu .sn-menu-inline-explain .sn-menu-inline-body');
  await expect(corpo.locator('a.filo-md-link').first()).toBeVisible({ timeout: 30_000 });
  const prima = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()));
  await corpo.locator('a.filo-md-link').first().click();
  await page.waitForTimeout(2500);
  const dopo = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()));
  console.log(JSON.stringify({ menuLink: { prima, dopo, url: page.url() } }));
  // nel riquadro
  await bersaglio(page);
  await page.locator('#b853').click({ button: 'right' });
  await page.locator('.sn-menu .sn-menu-inline-arrow').click();
  const riq = page.locator('.sn-popup .sn-popup-body');
  await expect(riq.locator('a.filo-md-link').first()).toBeVisible({ timeout: 30_000 });
  await riq.locator('a.filo-md-link').nth(1).click();
  await page.waitForTimeout(2500);
  const dopo2 = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()));
  console.log(JSON.stringify({ riqLink: { dopo2, url: page.url() } }));
});

test('traduci su pagina interna', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModello(app, RISPOSTA, 'light');
  const page = await openTab('filo://editor/editor.html');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  await bersaglio(page);
  await page.evaluate(() => {
    window.SN_ACTIONS.triggerExplainOrTranslate(window.SN_CONST.ACTIONS.TRANSLATE_SELECTION, window.SN_EXTRACT.getSelectionWithSentence(), null);
  });
  const riq = page.locator('.sn-popup .sn-popup-body');
  await expect(riq).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 30_000 });
  console.log(JSON.stringify({ traduci: await riq.innerHTML() }));
  await page.screenshot({ path: `${SHOTS}/traduci.png` });
});
