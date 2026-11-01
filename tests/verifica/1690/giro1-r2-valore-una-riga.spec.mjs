// Verifica #1690, giro 1, rilievo 2: in un campo alto una riga il valore del segnaposto, svegliato dal puntatore sulle x,
// non prende il clic dato a ciò che sta subito sopra il campo (#1448.12).

import { test, expect } from '../../fixtures/electron.mjs';
import { riquadroDelSegno } from '../../helpers/segniDelCorrettore.mjs';

const COLOMBO = '[nel 14xx][nel 1492][Cristoforo Colombo sbarcò in America il 12 ottobre 1492][segnaposto]';
const UNA_RIGA = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:60px 20px;font:14px sans-serif">
<a id="lnk" href="#cliccato" style="display:block;width:760px;height:30px">Rispondi a tutti</a>
<div id="ce" contenteditable="true" lang="it" style="width:760px;font:16px sans-serif;padding:2px;border:1px solid #999"></div></body>`;
const SCRITTO = "l'America l'hanno scoperta nel 14xx, e allora abbiamo discusso. ";

test('r2 campo alto una riga: dalle x il puntatore sale al collegamento sopra il campo, e il clic va al collegamento', async ({ app, openTab, testServer }) => {
  await app.evaluate(async (_e, riga) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
      correttore: { modelloErrori: true, ripetizioni: true, automatica: false, pausaRagionatoMs: 1000, segnaposti: true, segnapostiWeb: false },
    });
    const finto = async ({ messages }) => {
      const sistema = String(messages[0].content);
      const t = String(messages[messages.length - 1].content);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (sistema.includes('Sei il controllo rapido')) return fine('NIENTE');
      if (sistema.includes('proponi SUGGERIMENTI') && t.includes('14xx')) return fine(riga);
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, COLOMBO);
  const page = await testServer.openReady(openTab, UNA_RIGA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#ce').click();
  await page.keyboard.type(SCRITTO);
  const v = page.locator('.sn-spell-valori .sn-spell-valore', { hasText: '1492' });
  await expect(v).toBeVisible({ timeout: 8000 });
  const x = await riquadroDelSegno(page.locator('.sn-spell-overlay .sn-suggerimento', { hasText: '14xx' }));
  const ce = await page.locator('#ce').boundingBox();
  // Il puntatore era sulle x, poi sale dritto al collegamento appena sopra il campo.
  await page.mouse.move(x.x + x.width / 2, x.y + x.height / 2);
  await page.mouse.move(x.x + x.width / 2, ce.y - 6, { steps: 6 });
  await page.mouse.click(x.x + x.width / 2, ce.y - 6);
  await expect.poll(() => page.evaluate(() => location.hash), { timeout: 3000 }).toBe('#cliccato');
  await expect(page.locator('#ce')).toHaveText(/scoperta nel 14xx, e allora/);
});
