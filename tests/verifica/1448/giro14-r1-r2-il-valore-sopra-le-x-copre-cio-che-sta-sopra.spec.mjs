// Verifica #1448, giro 14. Rilievo 1: sulla prima riga di un campo con poco margine il valore esce dal campo e prende il
// clic della pagina. Rilievo 2: sulle righe dopo la prima il valore è velato e non si legge senza passare sulle x.

import { test, expect } from '../../fixtures/electron.mjs';

const COLOMBO = '[nel 14xx][nel 1492][Cristoforo Colombo sbarcò in America il 12 ottobre 1492][segnaposto]';

async function prepara(app) {
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
  }, COLOMBO);
}

const valore = (page) => page.locator('.sn-spell-valori .sn-spell-valore', { hasText: '1492' });

test('r2 sulla seconda riga il valore si legge senza passare sulle x', async ({ app, openTab, testServer }) => {
  await prepara(app);
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:60px 20px">
<div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px sans-serif;border:1px solid #999;padding:8px"></div></body>`, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#ce').click();
  await page.keyboard.type("Ieri sera a cena parlavamo di storia con gli amici di sempre, e ricordavo che l'America l'hanno scoperta nel 14xx, e allora abbiamo discusso. ");
  const v = valore(page);
  await expect(v).toBeVisible({ timeout: 10000 });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);

  // Chi scrive guarda il testo: il dato si vede subito, senza tasto destro e senza cercarlo col puntatore.
  const opacita = await v.evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(opacita).toBeGreaterThan(0.9);
});

test('r1 sulla prima riga di un campo con poco margine il clic sul collegamento sopra il campo va al collegamento', async ({ app, openTab, testServer }) => {
  await prepara(app);
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:60px 20px;font:14px sans-serif">
<div><a id="lnk" href="#cliccato" style="display:inline-block;padding-left:200px">Rispondi a tutti</a></div>
<textarea id="ta" lang="it" style="display:block;width:760px;height:100px;font:16px sans-serif;padding:2px"></textarea></body>`, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const scritto = "l'America l'hanno scoperta nel 14xx, e allora abbiamo discusso. ";
  await page.locator('#ta').click();
  await page.keyboard.type(scritto);
  const v = valore(page);
  await expect(v).toBeVisible({ timeout: 10000 });
  const b = await v.boundingBox();
  const l = await page.locator('#lnk').boundingBox();
  // Il valore sta sulla scritta del collegamento.
  expect(b.y).toBeLessThan(l.y + l.height - 4);
  expect(b.x).toBeGreaterThan(l.x + 200);

  // Chi scrive clicca su «Rispondi a tutti», dove il valore lo copre.
  await page.mouse.move(b.x + b.width / 2, b.y - 20);
  await page.mouse.click(b.x + b.width / 2, b.y + 3);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => location.hash)).toBe('#cliccato');
  expect(await page.locator('#ta').inputValue()).toBe(scritto);
});
