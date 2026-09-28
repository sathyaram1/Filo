// #853 giro 2, rilievo 1: dove finisce un indirizzo scritto in una risposta.
// Asterischi del grassetto, virgolette «» e puntini di sospensione finiscono
// dentro il link; le parentesi di un indirizzo (Mercurio_(astronomia)) lo tagliano.

import { test, expect } from '../../fixtures/electron.mjs';

const CASI = [
  ['https://example.com/grassetto', 'Vedi **https://example.com/grassetto** per i dettagli.'],
  ['https://example.com/virgolette', 'La pagina «https://example.com/virgolette» spiega tutto.'],
  ['https://example.com/puntini', 'Continua su https://example.com/puntini…'],
  ['https://it.wikipedia.org/wiki/Mercurio_(astronomia)', 'Il pianeta: [Mercurio](https://it.wikipedia.org/wiki/Mercurio_(astronomia)).'],
  ['https://it.wikipedia.org/wiki/Java_(linguaggio_di_programmazione)', 'Il linguaggio: https://it.wikipedia.org/wiki/Java_(linguaggio_di_programmazione) è diffuso.'],
];

test('un indirizzo nella spiegazione del menu porta alla pagina giusta, qualunque cosa lo circondi', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const risposta = CASI.map(([, riga]) => riga).join('\n\n');
  await app.evaluate(async (_e, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__origP853g2r1 = globalThis.__origP853g2r1 || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origP853g2r1,
      complete: async () => ({ text: t, toolCalls: [], reasoningDetails: [], usage: {} }),
    };
  }, risposta);

  const page = await openTab('filo://editor/editor.html');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  const doc = page.locator('#doc');
  await doc.click();
  await page.keyboard.type('Mercurio è il pianeta più vicino al Sole.');
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
  expect(indirizzi).toEqual(CASI.map(([url]) => url));
  await expect(corpo).not.toContainText('**');
});
