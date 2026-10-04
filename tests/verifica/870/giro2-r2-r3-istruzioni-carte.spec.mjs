// #870 giro 2, rilievi 2 e 3: quello che Filo legge sulle carte della home deve dire il vero.
// r2: le istruzioni generali non devono dire che le carte di sinistra non sono affar suo (lo strumento sì).
// r3: quando una carta di sinistra non si trova, l'esito descrive la colonna di destra com'è davvero.
import { test, expect } from '../../fixtures/electron.mjs';
import { homeTab } from './_comune.mjs';

async function modelloSpia(app, risposte) {
  await app.evaluate(async (_e, risp) => {
    const C = globalThis.SN_CONST;
    await chrome.storage.local.set({ filo_onboarding: { done: true } });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__giro = 0;
    globalThis.__visti = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      globalThis.__visti.push(JSON.stringify(messages));
      const r = risp[Math.min(globalThis.__giro++, risp.length - 1)];
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (r.testo) { try { onDelta && onDelta(r.testo); } catch (_) {} }
      return { ...base, text: r.testo || '', toolCalls: r.strumenti || [], finishReason: r.strumenti ? 'tool_calls' : 'stop' };
    };
  }, risposte);
}

test('le istruzioni non escludono le carte di sinistra, e l’esito di una carta non trovata dice la destra vera', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await homeTab(app);
  await page.locator('#tieni .dash-carta[data-tipo="mazzi"]').click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli' }).click();
  await expect(page.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
  await modelloSpia(app, [
    { strumenti: [{ id: 'c1', name: 'CARTA_HOME', arguments: JSON.stringify({ operazione: 'togli', carta: 'l’avviso della lavatrice' }) }] },
    { testo: 'Non la trovo.' },
  ]);
  await page.locator('#input').fill('togli l’avviso della lavatrice dalla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Non la trovo' })).toBeVisible({ timeout: 10_000 });
  const visti = await app.evaluate(() => globalThis.__visti);
  expect(visti[0], 'le istruzioni dicono al modello che le carte di sinistra non passano da CARTA_HOME').not.toContain('Riguarda le carte di destra');
  const esito = visti[1] || '';
  const m = esito.match(/\\"destra\\":\[[^\]]*\]/);
  expect(m && m[0], 'l’esito descrive la destra').toBeTruthy();
  expect(m[0], 'l’esito dice che i Mazzi sono a destra, ma l’utente li ha tolti').not.toContain('Mazzi');
});
