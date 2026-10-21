// Verifica #1448 giro 2, rilievo 1: un dato già trovato non si ricerca quando la sua frase cambia altrove (una pausa a
// metà frase, un refuso corretto): una ricerca sola, e il valore resta sopra le x invece di tornare ai puntini.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:60px 20px 20px;font:16px sans-serif">
<textarea id="ta" lang="it" style="display:block;width:760px;height:140px;font:22px sans-serif;padding:24px 8px 8px"></textarea>
</body>`;

async function apri(app, openTab, testServer) {
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
    const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
    const finto = async ({ messages }) => {
      const t = String(messages[messages.length - 1].content);
      if (t.includes('Chi scrive ha messo delle x')) return fine('[27][Rapporto prezzo/utili di Alphabet][1][20 ottobre 2026]');
      if (t.includes('proponi SUGGERIMENTI') && t.includes('p/e di soli xx')) return fine('[di soli xx][][Alphabet P/E ratio][cerca][web]');
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    const F = globalThis.SN_FONTI_SEGNAPOSTO;
    F.wikipedia = async () => [];
    // Una ricerca vera dura qualche secondo: qui due, così i puntini di una seconda ricerca si vedono.
    F.web = async (q) => {
      globalThis.__webChieste.push(q);
      await new Promise((r) => setTimeout(r, 2000));
      return [{ titolo: 'Alphabet PE ratio', sito: 'borsa.example', url: 'https://borsa.example/goog', data: '', testo: 'Alphabet P/E ratio: 27.1' }];
    };
  });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const valore = (page) => page.locator('.sn-spell-valori .sn-spell-valore', { hasText: '27' });
const cercando = (page) => page.locator('.sn-spell-valori .sn-spell-valore.sn-cercando');

async function restaIlValore(page, ms) {
  for (const fine = Date.now() + ms; Date.now() < fine;) {
    expect(await cercando(page).count(), 'il valore trovato è tornato ai puntini di una nuova ricerca').toBe(0);
    await expect(valore(page)).toHaveCount(1);
    await page.waitForTimeout(200);
  }
}

test('r1 una pausa a metà frase: finita la frase il dato non si cerca di nuovo', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('Google ha un p/e di soli xx, ');
  await expect(valore(page)).toBeVisible({ timeout: 10000 });
  await page.keyboard.type('davvero basso per una azienda così. ');
  await restaIlValore(page, 4500);
  expect(await app.evaluate(() => globalThis.__webChieste)).toEqual(['Alphabet P/E ratio']);
});

test('r1 un refuso corretto nella stessa frase: il dato non si cerca di nuovo', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('Google ha un p/e di soli xx, davero basso. ');
  await expect(valore(page)).toBeVisible({ timeout: 10000 });
  const i = (await page.locator('#ta').inputValue()).indexOf('davero') + 3;
  await page.locator('#ta').evaluate((e, i) => e.setSelectionRange(i, i), i);
  await page.keyboard.type('v');
  await page.keyboard.press('End');
  await restaIlValore(page, 4500);
  expect(await app.evaluate(() => globalThis.__webChieste)).toEqual(['Alphabet P/E ratio']);
});
