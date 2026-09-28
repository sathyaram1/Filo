// #853 giro 1, rilievo 1: un indirizzo scritto per intero che contiene un
// apostrofo (Valle_d'Aosta) diventa un link tagliato all'apostrofo, e porta
// alla pagina sbagliata. Le virgolette attorno a un indirizzo restano fuori.

import { test, expect } from '../../fixtures/electron.mjs';

const WIKI = "https://it.wikipedia.org/wiki/Valle_d'Aosta";
const RISPOSTA = `Vedi ${WIKI} per la storia, oppure "https://example.com/guida" fra virgolette.`;

test("un indirizzo con l'apostrofo nella spiegazione del menu resta un link intero", async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(async (_e, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__origP853r1 = globalThis.__origP853r1 || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origP853r1,
      complete: async () => ({ text: t, toolCalls: [], reasoningDetails: [], usage: {} }),
    };
  }, RISPOSTA);

  const page = await openTab('filo://editor/editor.html');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  const doc = page.locator('#doc');
  await doc.click();
  await page.keyboard.type('La Valle d’Aosta è una regione autonoma.');
  await page.evaluate(() => {
    const r = document.createRange(); r.selectNodeContents(document.querySelector('#doc'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await doc.click({ button: 'right' });
  const corpo = page.locator('.sn-menu .sn-menu-inline-explain .sn-menu-inline-body');
  await expect(corpo).not.toHaveText(/Spiegazione…/, { timeout: 30_000 });

  const link = corpo.locator('a.filo-md-link');
  await expect(link).toHaveCount(2);
  await expect(link.nth(0)).toHaveAttribute('href', WIKI);
  await expect(link.nth(0)).toHaveText(WIKI);
  await expect(link.nth(1)).toHaveAttribute('href', 'https://example.com/guida');
});
