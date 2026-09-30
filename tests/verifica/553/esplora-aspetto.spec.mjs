import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function stubModello(app, piani) {
  await app.evaluate(async (_e, piani) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const n = globalThis.__chiamate.push(1) - 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const piano = piani[Math.min(n, piani.length - 1)];
      if (piano.finale) { try { onDelta && onDelta(piano.finale); } catch (_) {} return { ...base, text: piano.finale, toolCalls: [], finishReason: 'stop' }; }
      return { ...base, text: '', toolCalls: piano.strumenti.map((s, i) => ({ id: `c${n}_${i}`, name: s.nome, arguments: JSON.stringify(s.args) })), finishReason: 'tool_calls' };
    };
  }, piani);
}

for (const tema of ['light', 'dark']) {
  test(`aspetto righe lettura ${tema}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await app.evaluate(async (_e, tema) => globalThis.SN_STORAGE.updateSettings({ theme: tema }), tema);
    const page = await openTab(NEWTAB);
    const a = testServer.html('<!doctype html><html><head><title>Listino modelli di settembre: prezzi per milione di token e punteggi</title></head><body><main><p>Aurora-7 costa 0,37.</p></main></body></html>');
    const b = testServer.html('<!doctype html><html><head><title>Orari</title></head><body><main><p>Aperto 9-18.</p></main></body></html>');
    await app.evaluate(() => { globalThis.SN_LETTURA_PAGINE._dip.scarica = (u, o) => fetch(u, o); });
    await stubModello(app, [
      { strumenti: [{ nome: 'LEGGI_PAGINA', args: { url: a } }, { nome: 'LEGGI_PAGINA', args: { url: b } }, { nome: 'LEGGI_PAGINA', args: { url: 'https://sito-che-non-esiste.invalid/x' } }] },
      { finale: 'Aurora-7 costa 0,37 dollari per milione di token.' },
    ]);
    await page.locator('#input').fill('quanto costa aurora?');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Aurora-7 costa' })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: `tests/.shots/553-g14-attivita-chiusa-${tema}.png` });
    await page.locator('.dash-activity-head').click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `tests/.shots/553-g14-attivita-aperta-${tema}.png` });
    const righe = await page.locator('.dash-activity-row').allInnerTexts();
    console.log(tema, JSON.stringify(righe));
  });
}
