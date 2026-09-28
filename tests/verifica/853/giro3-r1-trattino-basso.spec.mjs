// #853 giro 3, rilievo 1: un indirizzo che finisce col trattino basso
// (le ancore della documentazione Python, #object.__init__) perde i trattini
// e porta a un punto della pagina che non esiste.

import { test, expect } from '../../fixtures/electron.mjs';

const CASI = [
  'https://docs.python.org/3/reference/datamodel.html#object.__init__',
  'https://docs.python.org/3/reference/datamodel.html#object.__eq__',
];
const RISPOSTA = `Il costruttore: ${CASI[0]} e il confronto: ${CASI[1]}.`;

test('un indirizzo che finisce col trattino basso resta intero nel link della spiegazione', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(async (_e, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__origP853g3r1 = globalThis.__origP853g3r1 || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origP853g3r1,
      complete: async () => ({ text: t, toolCalls: [], reasoningDetails: [], usage: {} }),
    };
  }, RISPOSTA);

  const page = await openTab('filo://editor/editor.html');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  const doc = page.locator('#doc');
  await doc.click();
  await page.keyboard.type('In Python il metodo init costruisce l’oggetto.');
  await page.evaluate(() => {
    const r = document.createRange(); r.selectNodeContents(document.querySelector('#doc'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await doc.click({ button: 'right' });
  const corpo = page.locator('.sn-menu .sn-menu-inline-explain .sn-menu-inline-body');
  await expect(corpo).not.toHaveText(/Spiegazione…/, { timeout: 30_000 });

  const link = corpo.locator('a.filo-md-link');
  await expect(link).toHaveCount(CASI.length);
  const indirizzi = await link.evaluateAll((els) => els.map((a) => a.getAttribute('href')));
  expect(indirizzi).toEqual(CASI);
});
