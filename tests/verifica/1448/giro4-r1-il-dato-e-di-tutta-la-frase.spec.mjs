// Verifica #1448 giro 4, rilievo 1: quello che il dato descrive può stare dopo le x («ci sono xx abitanti a Milano»,
// «nel 19xx uscì il primo iPhone»): due frasi che cominciano uguali non si prendono lo stesso valore, e cambiare il
// soggetto dopo le x cambia il dato.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:60px 20px 20px;font:16px sans-serif">
<textarea id="ta" lang="it" style="display:block;width:900px;height:160px;font:22px sans-serif;padding:24px 8px 8px"></textarea>
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
      if (t.includes('Chi scrive ha messo delle x')) {
        return fine(t.includes('Popolazione di Milano') ? '[1370000][Abitanti di Milano][1][2025]' : '[2750000][Abitanti di Roma][1][2025]');
      }
      if (t.includes('proponi SUGGERIMENTI')) {
        return fine('[xx abitanti a Roma][][Popolazione di Roma][cerca][web]\n[xx abitanti a Milano][][Popolazione di Milano][cerca][web]');
      }
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    const F = globalThis.SN_FONTI_SEGNAPOSTO;
    F.wikipedia = async () => [];
    F.web = async (q) => {
      globalThis.__webChieste.push(q);
      return [{ titolo: q, sito: 'istat.example', url: 'https://istat.example/x', data: '', testo: `${q}: dati` }];
    };
  });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const valori = (page) => page.locator('.sn-spell-valori .sn-spell-valore:not(.sn-cercando)');

test('r1 due frasi che cominciano uguali: ciascuna ha il suo dato', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('Ci sono xx abitanti a Roma. ');
  await expect(valori(page)).toHaveText(['2750000'], { timeout: 10000 });
  await page.keyboard.type('Ci sono xx abitanti a Milano. ');
  await expect.poll(async () => (await valori(page).allTextContents()).sort(), { timeout: 10000 }).toEqual(['1370000', '2750000']);
  expect((await app.evaluate(() => globalThis.__webChieste)).sort()).toEqual(['Popolazione di Milano', 'Popolazione di Roma']);
});

test('r1 cambiato il soggetto dopo le x, il dato è quello nuovo', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  const ta = page.locator('#ta');
  await ta.click();
  await page.keyboard.type('Ci sono xx abitanti a Roma. ');
  await expect(valori(page)).toHaveText(['2750000'], { timeout: 10000 });
  const i = (await ta.inputValue()).indexOf('Roma');
  await ta.evaluate((e, i) => e.setSelectionRange(i, i + 4), i);
  await page.keyboard.type('Milano');
  await page.keyboard.press('End');
  await expect(valori(page)).toHaveText(['1370000'], { timeout: 10000 });
});
