// Verifica #1448 giro 2, rilievo 2: se le fonti non rispondono (rete giù, Wikipedia lenta) il tasto destro dice che la
// ricerca non è riuscita e offre «Cerca di nuovo», che tornata la rete trova il valore; non «Non ho trovato questo dato».

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { riquadroDelSegno } from '../../helpers/segniDelCorrettore.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:60px 20px 20px;font:16px sans-serif">
<textarea id="ta" lang="it" style="display:block;width:760px;height:140px;font:22px sans-serif;padding:24px 8px 8px"></textarea>
</body>`;

test('r2 fonti irraggiungibili: «La ricerca non è riuscita» e «Cerca di nuovo» trova il valore', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
      correttore: { modelloErrori: true, ripetizioni: true, pausaRagionatoMs: 1000, segnaposti: true, segnapostiWeb: true },
    });
    const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
    const finto = async ({ messages }) => {
      const t = String(messages[messages.length - 1].content);
      if (t.includes('Chi scrive ha messo delle x')) return fine('[27][Rapporto prezzo/utili di Alphabet][1][20 ottobre 2026]');
      if (t.includes('proponi SUGGERIMENTI') && t.includes('p/e di soli xx')) return fine('[di soli xx][][Alphabet P/E ratio][cerca][web]');
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    globalThis.__reteGiu = true;
    const F = globalThis.SN_FONTI_SEGNAPOSTO;
    const giu = () => { throw new Error('fetch failed: getaddrinfo ENOTFOUND'); };
    F.wikipedia = async () => (globalThis.__reteGiu ? giu() : []);
    F.web = async () => (globalThis.__reteGiu ? giu()
      : [{ titolo: 'Alphabet PE ratio', sito: 'borsa.example', url: 'https://borsa.example/goog', data: '', testo: 'Alphabet P/E ratio: 27.1' }]);
  });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#ta').click();
  await page.keyboard.type('Google ha un p/e di soli xx, davvero basso. ');
  const segno = page.locator('.sn-spell-overlay .sn-suggerimento', { hasText: 'xx' });
  await expect(segno).toHaveCount(1, { timeout: 8000 });
  await expect(page.locator('.sn-spell-valori .sn-spell-valore.sn-cercando')).toHaveCount(0, { timeout: 8000 });
  const b = await riquadroDelSegno(segno);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const menu = menuDi(page);
  await expect(menu.pannelli.first()).toBeVisible({ timeout: 5000 });
  await expect(menu.locator('.sn-menu-segno')).toContainText('La ricerca non è riuscita', { timeout: 3000 });
  await app.evaluate(() => { globalThis.__reteGiu = false; });
  await menu.voce('Cerca di nuovo').click();
  await expect(page.locator('.sn-spell-valori .sn-spell-valore', { hasText: '27' })).toBeVisible({ timeout: 8000 });
});
