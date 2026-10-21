// Verifica #1448 giro 1, rilievo 1: l'esempio dell'owner, due «xx» nella stessa frase con due dati da cercare diversi
// (il p/e di Google e quello medio del Nasdaq alle dot-com), deve dare due ricerche e due valori diversi.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:60px 20px 20px;font:16px sans-serif">
<textarea id="ta" lang="it" style="display:block;width:900px;height:140px;font:22px sans-serif;padding:24px 8px 8px"></textarea>
</body>`;

const FRASE = 'Google ha un p/e di soli xx, mentre al picco delle dot-com il Nasdaq aveva in media un p/e di xx. ';

test('r1 due «xx» da cercare nella stessa frase hanno ciascuno la sua ricerca e il suo valore', async ({ app, openTab, testServer }) => {
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
    globalThis.__webChieste = [];
    const finto = async ({ messages }) => {
      const t = String(messages[messages.length - 1].content);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('Chi scrive ha messo delle x')) {
        return fine(t.includes('Nasdaq dot-com') ? '[175][P/E medio del Nasdaq nel 2000][1][marzo 2000]' : '[27][P/E di Alphabet][1][20 ottobre 2026]');
      }
      if (t.includes('proponi SUGGERIMENTI') && t.includes('Nasdaq aveva')) {
        return fine('[di soli xx][][Alphabet P/E ratio][cerca][web]\n[media un p/e di xx][][Nasdaq dot-com average P/E 2000][cerca][web]');
      }
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    const F = globalThis.SN_FONTI_SEGNAPOSTO;
    F.wikipedia = async () => [];
    F.web = async (q) => {
      globalThis.__webChieste.push(q);
      return [{ titolo: q, sito: 'borsa.example', url: 'https://borsa.example/x', data: '', testo: `${q}: dati` }];
    };
  });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#ta').click();
  await page.keyboard.type(FRASE);
  const valori = page.locator('.sn-spell-valori .sn-spell-valore:not(.sn-cercando)');
  await expect(valori).toHaveCount(2, { timeout: 10000 });
  await page.waitForTimeout(800);
  const testi = await valori.allTextContents();
  expect(testi.sort()).toEqual(['175', '27']);
  expect((await app.evaluate(() => globalThis.__webChieste)).sort()).toEqual(['Alphabet P/E ratio', 'Nasdaq dot-com average P/E 2000']);
});
