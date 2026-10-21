// Aiuto delle prove del giro 3 di #1448: una pagina con un campo, il controllo ragionato e la ricerca finti.
// `rilettura(n)`: cosa risponde il controllo ragionato alla n-esima lettura della frase del p/e.

import { expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:60px 20px 20px;font:16px sans-serif">
<textarea id="ta" lang="it" style="display:block;width:760px;height:140px;font:22px sans-serif;padding:24px 8px 8px"></textarea>
</body>`;

export async function apri(app, openTab, testServer, opz = {}) {
  await app.evaluate(async (_e, opz) => {
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
    globalThis.__letture = 0;
    const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
    const finto = async ({ messages }) => {
      const tutto = String(messages[messages.length - 1].content);
      if (tutto.includes('Chi scrive ha messo delle x')) return fine('[27][Rapporto prezzo/utili di Alphabet][1][20 ottobre 2026]');
      const nuovo = tutto.includes('TESTO NUOVO:') ? tutto.slice(tutto.indexOf('TESTO NUOVO:')) : '';
      if (tutto.includes('proponi SUGGERIMENTI') && nuovo.includes('p/e di soli xx')) {
        const n = ++globalThis.__letture;
        const r = (opz.letture || {})[n] ?? '[di soli xx][][Alphabet P/E ratio][cerca][web]';
        return fine(r);
      }
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    const F = globalThis.SN_FONTI_SEGNAPOSTO;
    F.wikipedia = async () => [];
    F.web = async (q) => {
      globalThis.__webChieste.push(q);
      await new Promise((r) => setTimeout(r, 1500));
      return [{ titolo: 'Alphabet PE ratio', sito: 'borsa.example', url: 'https://borsa.example/goog', data: '', testo: 'Alphabet P/E ratio: 27.1' }];
    };
  }, opz);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

export const valore = (page, t) => page.locator('.sn-spell-valori .sn-spell-valore', { hasText: t });
export const ocra = (page, t) => page.locator('.sn-spell-overlay .sn-suggerimento', { hasText: t });

export async function restaIlValore(page, testo, ms) {
  for (const fine = Date.now() + ms; Date.now() < fine;) {
    expect(await page.locator('.sn-spell-valori .sn-spell-valore.sn-cercando').count(), 'il valore trovato è tornato ai puntini di una nuova ricerca').toBe(0);
    await expect(valore(page, testo), 'il valore trovato è sparito').toHaveCount(1);
    await page.waitForTimeout(200);
  }
}
