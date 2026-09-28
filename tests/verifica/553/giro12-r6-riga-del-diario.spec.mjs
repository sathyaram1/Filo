// Verifica #553 — giro 12, rilievo 6. Dopo una lettura, la riga nel diario della chat dice solo il titolo che si è
// scritto il sito: non da quale sito viene, non se Filo l'ha letta dalla scheda dell'utente, e non si apre.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const NEWTAB = 'filo://newtab/';

async function stubModello(app, piani) {
  await app.evaluate(async (_e, piani) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = 0;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({ text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {} });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const n = globalThis.__chiamate++;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const piano = piani[Math.min(n, piani.length - 1)];
      if (piano.finale) { try { onDelta && onDelta(piano.finale); } catch (_) {} return { ...base, text: piano.finale, toolCalls: [], finishReason: 'stop' }; }
      return { ...base, text: '', toolCalls: piano.map((args, i) => ({ id: `c${n}_${i}`, name: 'LEGGI_PAGINA', arguments: JSON.stringify(args) })), finishReason: 'tool_calls' };
    };
  }, piani);
}

test('la riga della lettura dice da quale sito viene e si può aprire', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await openTab(NEWTAB);
  // Il titolo lo sceglie chi scrive la pagina.
  const url = testServer.html(`<!doctype html><html><head><title>Filo · Impostazioni di sicurezza</title></head><body><main>
<h1>Offerte</h1><p>Il caffè costa 1,20 euro e il cornetto 1,50: prezzi validi fino a domenica in tutti i punti vendita della catena.</p></main></body></html>`);
  await app.evaluate(() => { globalThis.SN_LETTURA_PAGINE._cache.clear(); globalThis.SN_LETTURA_PAGINE._dip.scarica = (u, o) => fetch(u, o); });
  await stubModello(app, [[{ url }], { finale: 'Il caffè costa 1,20 euro.' }]);
  await page.locator('#input').fill('quanto costa il caffè?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Il caffè costa 1,20 euro.' })).toBeVisible({ timeout: 20_000 });
  await page.locator('.dash-activity-head').click();
  const riga = page.locator('.dash-activity-row', { hasText: 'Leggo la pagina' });
  await expect(riga).toHaveCount(1);
  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/553-giro12-riga-lettura.png' });
  // Chi guarda deve poter sapere dove è andato Filo: il sito, o almeno il suo indirizzo sotto il puntatore.
  const testo = await riga.innerText();
  const titolo = await riga.evaluate((el) => [el, ...el.querySelectorAll('*')].map((x) => x.getAttribute('title') || x.getAttribute('href') || '').join(' '));
  expect(`${testo} ${titolo}`).toContain('127.0.0.1');
});
