// #853 giro 4, rilievo 1: le parti messe da parte (codice, link) tornano al
// loro posto un livello solo: il testo di un link fatto di codice diventa «0»,
// il grassetto dentro un link resta con gli asterischi, e un indirizzo attaccato
// a un pezzo di codice si porta dietro il segnaposto al posto del codice.

import { test, expect } from '../../fixtures/electron.mjs';

const RISPOSTA = [
  'Vedi [`Array.prototype.map()`](https://developer.mozilla.org/it/docs/Web/JavaScript/Reference/Global_Objects/Array/map).',
  '',
  'Fonte: [**Wikipedia**](https://it.wikipedia.org/wiki/Roma)',
  '',
  'Pagina: https://example.com/guida`index.html` fine.',
].join('\n');

test('il testo dei link resta quello scritto, anche se è codice o grassetto', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(async (_e, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__origP853g4r1 = globalThis.__origP853g4r1 || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origP853g4r1,
      complete: async () => ({ text: t, toolCalls: [], reasoningDetails: [], usage: {} }),
    };
  }, RISPOSTA);

  const page = await openTab('filo://editor/editor.html');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  const doc = page.locator('#doc');
  await doc.click();
  await page.keyboard.type('Una frase qualunque.');
  await page.evaluate(() => {
    const r = document.createRange(); r.selectNodeContents(document.querySelector('#doc'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await doc.click({ button: 'right' });
  const corpo = page.locator('.sn-menu .sn-menu-inline-explain .sn-menu-inline-body');
  await expect(corpo.locator('a.filo-md-link').first()).toBeVisible({ timeout: 30_000 });

  const mdn = corpo.locator('a.filo-md-link[href*="developer.mozilla.org"]');
  await expect(mdn).toHaveText('Array.prototype.map()');
  await expect(mdn.locator('code')).toHaveText('Array.prototype.map()');

  const wiki = corpo.locator('a.filo-md-link[href="https://it.wikipedia.org/wiki/Roma"]');
  await expect(wiki).toHaveText('Wikipedia');
  await expect(wiki.locator('strong')).toHaveText('Wikipedia');

  await expect(corpo).toContainText('index.html');
  const segnaposti = await corpo.evaluate((el) => {
    const re = /[-]/;
    const hrefs = [...el.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    return re.test(el.textContent) || hrefs.some((h) => re.test(h));
  });
  expect(segnaposti, 'segnaposti interni finiti nel testo o negli indirizzi').toBe(false);
});
