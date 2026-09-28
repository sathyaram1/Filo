// Esplorazione giro 4 (#853): altre pagine interne, follow-up, link ai bordi.
import { test, expect } from '../../fixtures/electron.mjs';

const RISPOSTA = 'Il **grassetto** resta. Vedi https://it.wikipedia.org/wiki/Mercurio_(astronomia) e **https://example.com/guida**.';

async function preparaModello(app, testo) {
  await app.evaluate(async (_e, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash', [C.ACTIONS.TRANSLATE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__orig853 = globalThis.__orig853 || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__orig853,
      complete: async () => ({ text: t, toolCalls: [], reasoningDetails: [], usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta(t); return { text: t, usage: {} }; },
    };
  }, testo);
}

const PAGINE = [
  ['feedback', 'filo://feedback/feedback.html'],
  ['decks', 'filo://decks/decks.html'],
  ['history', 'filo://history/history.html'],
  ['archive', 'filo://archive/archive.html'],
  ['preferences', 'filo://preferences/preferences.html'],
  ['options', 'filo://options/options.html'],
  ['downloads', 'filo://downloads/downloads.html'],
  ['board', 'filo://board/board.html'],
  ['credits', 'filo://credits/credits.html'],
  ['transparency', 'filo://transparency/transparency.html'],
];

for (const [nome, url] of PAGINE) {
  test(`esplora ${nome}`, async ({ app, openTab }) => {
    test.setTimeout(60_000);
    const page = await openTab(url);
    const cs = await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 10_000 }).then(() => true, () => false);
    await preparaModello(app, RISPOSTA);
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.id = 'b853';
      p.textContent = 'La fotosintesi clorofilliana trasforma la luce in zuccheri.';
      p.style.cssText = 'position:fixed;left:40px;top:120px;z-index:2147480000;margin:0;padding:8px;font:16px sans-serif;background:#fff;color:#000';
      document.body.appendChild(p);
      const r = document.createRange(); r.selectNodeContents(p);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await page.locator('#b853').click({ button: 'right' });
    await page.waitForTimeout(2500);
    const esito = await page.evaluate(() => {
      const menu = document.querySelector('.sn-menu');
      const corpo = document.querySelector('.sn-menu-inline-explain .sn-menu-inline-body');
      return {
        menu: !!menu,
        md: !!window.SN_MARKDOWN,
        html: corpo ? corpo.innerHTML.slice(0, 600) : null,
        altriMenu: [...document.querySelectorAll('[class*=menu]')].filter((e) => e.offsetParent).map((e) => e.className).slice(0, 5),
      };
    });
    console.log(nome, 'cs=', cs, JSON.stringify(esito));
    await page.screenshot({ path: `tests/.shots/853-g4-${nome}.png` });
  });
}

test('esplora follow-up e traduci nell\'Editor', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://editor/');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 15_000 });
  await preparaModello(app, RISPOSTA);
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'b853';
    p.textContent = 'The quick brown fox jumps over the lazy dog.';
    p.style.cssText = 'position:fixed;left:40px;top:120px;z-index:2147480000;margin:0;padding:8px;font:16px sans-serif;background:#fff;color:#000';
    document.body.appendChild(p);
    const r = document.createRange(); r.selectNodeContents(p);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.locator('#b853').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await page.waitForTimeout(1500);
  const voci = await menu.evaluate((m) => [...m.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent.trim()).map((e) => e.className + ':' + e.textContent.trim()).slice(0, 40));
  console.log('VOCI', JSON.stringify(voci));
  await menu.locator('.sn-menu-inline-arrow').click();
  const body = page.locator('.sn-popup .sn-popup-body');
  await expect(body).toBeVisible();
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 30_000 });
  await page.locator('.sn-popup .sn-popup-input').fill('e poi?');
  await page.locator('.sn-popup .sn-popup-input').press('Enter');
  await page.waitForTimeout(3000);
  const html = await body.evaluate((el) => el.innerHTML);
  console.log('RIQUADRO', html.slice(0, 3000));
  await page.screenshot({ path: 'tests/.shots/853-g4-followup.png' });
});
