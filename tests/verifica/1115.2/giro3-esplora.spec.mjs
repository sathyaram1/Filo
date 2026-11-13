// Esplorazione del giro 3: si cancella.
import { test, expect } from '../../fixtures/electron.mjs';

async function apri(app, openTab, testServer, html, righe) {
  await app.evaluate(async (_e, righe) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
    });
    globalThis.__ocra = [];
    globalThis.__righe = righe;
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('proponi SUGGERIMENTI')) { globalThis.__ocra.push(messages[messages.length - 1].content); return fine(globalThis.__righe); }
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, righe);
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}
const ocra = (page) => page.locator('.sn-spell-overlay .sn-suggerimento');
const CHAT = (sopra) => `<!doctype html><meta charset="utf-8"><title>Chat</title><body style="margin:0;padding:20px;font:16px sans-serif"><main>${sopra}<textarea id="ta" spellcheck="true" lang="it" style="display:block;width:760px;height:140px;font:22px monospace"></textarea></main></body>`;

test('segnalazione senza punto finale: la data parte al ragionato e il suo segno compare', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, CHAT('<div class="chat"><p>Luca: ti ricordi il matrimonio di Marta, nel 2024?</p></div>'),
    '[martedì 9 ottobre][mercoledì 9 ottobre][Il 9 ottobre 2024 è mercoledì][suggerimento]');
  await page.locator('#ta').click();
  await page.keyboard.type('certo, martedì 9 ottobre, pioveva');
  await expect.poll(() => app.evaluate(() => globalThis.__ocra.length), { timeout: 15_000 }).toBeGreaterThan(0);
  const p = (await app.evaluate(() => globalThis.__ocra)).at(-1);
  console.log('PROMPT-DATE', p.slice(p.indexOf('DATE DA')).slice(0, 600));
  await expect(ocra(page)).toHaveCount(1, { timeout: 8000 });
  console.log('OCRA', await ocra(page).allTextContents());
});

test('l\'anno arriva nella conversazione dopo che la data è stata scritta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, CHAT('<div class="chat" id="chat"><p>Luca: ciao</p></div>'), '[][][][nessuno]');
  await page.locator('#ta').click();
  await page.keyboard.type('certo, mercoledì 9 ottobre, pioveva.');
  await page.waitForTimeout(4000);
  console.log('PRIMA', await ocra(page).allTextContents());
  await page.evaluate(() => { const p = document.createElement('p'); p.textContent = 'Luca: ti ricordi il matrimonio di Marta, nel 2024?'; document.getElementById('chat').appendChild(p); });
  await page.locator('#ta').click();
  await page.keyboard.type(' ');
  await page.waitForTimeout(5000);
  console.log('DOPO', await ocra(page).allTextContents(), (await app.evaluate(() => globalThis.__ocra.length)));
});
