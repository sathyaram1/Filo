// Verifica #1448, giro 13, rilievo 1: con le x sulla seconda riga di un campo, il valore trovato sta sopra la riga prima
// e ne copre le parole; un clic su quelle parole, per mettere lì il cursore, scrive il valore nel testo.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:60px 20px 20px;font:16px sans-serif">
<textarea id="ta" lang="it" style="display:block;width:760px;height:140px;font:22px sans-serif;padding:8px"></textarea>
</body>`;

const RIGA = '[nel 14xx][nel 1492][Cristoforo Colombo sbarcò in America il 12 ottobre 1492][segnaposto]';
const TESTO = "Ieri sera a cena parlavamo di storia con gli amici di sempre, e ricordavo che l'America l'hanno scoperta nel 14xx. ";

test('r1 un clic sulla riga sopra le x mette il cursore lì e non scrive il valore', async ({ app, openTab, testServer }) => {
  await app.evaluate(async (_e, riga) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
      correttore: { modelloErrori: true, pausaRagionatoMs: 1000, segnaposti: true, segnapostiWeb: false },
    });
    const finto = async ({ messages }) => {
      const sistema = String(messages[0].content);
      const t = String(messages[messages.length - 1].content);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (sistema.includes('proponi SUGGERIMENTI') && t.includes('14xx')) return fine(riga);
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    globalThis.SN_FONTI_SEGNAPOSTO.wikipedia = async () => [];
    globalThis.SN_FONTI_SEGNAPOSTO.web = async () => [];
  }, RIGA);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#ta').click();
  await page.keyboard.type(TESTO);
  const v = page.locator('.sn-spell-valori .sn-spell-valore', { hasText: '1492' });
  await expect(v).toBeVisible({ timeout: 10000 });

  // Le x stanno sulla seconda riga: il valore sta sopra di loro, cioè sulla prima riga del campo.
  const ta = await page.locator('#ta').boundingBox();
  const b = await v.boundingBox();
  const prima = { alto: ta.y + 8, basso: ta.y + 8 + 26 };
  expect(b.y + b.height / 2).toBeGreaterThan(prima.alto);
  expect(b.y + b.height / 2).toBeLessThan(prima.basso);

  // Chi scrive clicca sulla parola della prima riga che vede lì sotto, per correggerla.
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(400);
  const stato = await page.locator('#ta').evaluate((el) => ({ testo: el.value, cursore: el.selectionStart }));
  expect(stato.testo).toBe(TESTO);
  expect(stato.cursore).toBeLessThan(TESTO.indexOf('ricordavo'));
});
