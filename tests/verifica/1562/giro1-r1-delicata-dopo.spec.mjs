// Verifica #1562 giro 1, rilievo 1: un sito segnato come delicato dopo che le sue pagine sono già andate in chat non
// deve più mandare i loro titoli al modello dal messaggio dopo; resta solo il nome del sito.

import { test, expect } from '../../fixtures/electron.mjs';

async function preparaModello(app, copione) {
  await app.evaluate(async (_e, { copione }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
    });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, tools, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (!(!!messages[0] && messages[0].role === 'system' && String(messages[0].content || '').startsWith(globalThis.SN_CONST.PROMPTS.filoChatStatic()))) {
        return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      }
      globalThis.__chiamate.push(JSON.parse(JSON.stringify({ messages, tools })));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      try { if (r.text) onDelta && onDelta(r.text); } catch (_) {}
      return { ...base, text: r.text || '', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { copione });
}

async function scrivi(home, testo, risposta) {
  await home.locator('#input').fill(testo);
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo', { hasText: risposta })).toBeVisible({ timeout: 15_000 });
  await expect(home.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
}

const testo = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join(''));

test('r1 un sito segnato delicato dopo il messaggio: dal messaggio dopo il modello non ha più i titoli delle sue pagine', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await preparaModello(app, [{ text: 'Ciao!' }, { text: 'Va tutto bene.' }, { text: 'Prego.' }]);
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await scrivi(home, 'ciao', 'Ciao!');

  const sito = await testServer.openReady(openTab, '<!doctype html><title>Esito esame clinico di Mario</title><p>esito</p>', { pubblico: true });
  await expect(sito).toHaveTitle('Esito esame clinico di Mario');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).map((p) => p.titolo)), { timeout: 20_000 })
    .toContain('Esito esame clinico di Mario');
  await home.bringToFront();
  await scrivi(home, 'cosa vuol dire?', 'Va tutto bene.');
  const prima = await app.evaluate(() => globalThis.__chiamate);
  expect(testo(prima[1].messages[prima[1].messages.length - 1])).toContain('Esito esame clinico di Mario');

  // L'utente segna il sito come delicato nella Sicurezza.
  await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    const security = { ...(s.security || {}) };
    security.pagineDelicate = { ...(security.pagineDelicate || {}), siti: ['sito-pubblico.test'] };
    await globalThis.SN_STORAGE.updateSettings({ security });
  });
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_DELICATE.filtro())('http://sito-pubblico.test/x'))).toBeTruthy();
  await scrivi(home, 'grazie', 'Prego.');

  const chiamate = await app.evaluate(() => globalThis.__chiamate);
  const tutto = chiamate[chiamate.length - 1].messages.map(testo).join('\n');
  expect(tutto, 'il titolo della pagina delicata torna al modello a ogni messaggio').not.toContain('Esito esame clinico di Mario');
  expect(tutto).toMatch(/sito-pubblico\.test: 1 pagina \(delicata: qui solo il sito\)/);
});
