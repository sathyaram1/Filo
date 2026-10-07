import { test, expect } from '../../fixtures/electron.mjs';

const IBAN = 'IT60X0542811101000000123456';

async function primaScheda(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function preparaModello(app, copione) {
  await app.evaluate(async (_e, copione) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, tools, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = Array.isArray(tools) && tools.some((t) => JSON.stringify(t).includes('NAVIGA'));
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      globalThis.__chiamate.push(JSON.parse(JSON.stringify(messages)));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      if (r.text) { try { onDelta && onDelta(r.text); } catch (_) {} }
      return {
        ...base, text: r.text || '',
        toolCalls: (r.tools || []).map((t, i) => ({ id: `t${globalThis.__chiamate.length}_${i}`, name: t.name, arguments: JSON.stringify(t.args || {}) })),
        reasoningDetails: [], finishReason: r.tools ? 'tool_calls' : 'stop',
      };
    };
  }, copione);
}

// L'IBAN lo scrive l'utente al messaggio prima, nella stessa scheda: le coordinate le ha chieste lui (#530).
test('r1 le coordinate scritte dall\'utente al messaggio prima, nella stessa scheda, valgono come chieste', async ({ app }) => {
  test.setTimeout(90_000);
  const home = await primaScheda(app);
  await preparaModello(app, [
    { text: 'Segnato il tuo IBAN.' },
    { text: '', tools: [{ name: 'NAVIGA', args: { url: `https://bonifici.example/nuovo?iban=${IBAN}` } }] },
    { text: 'Fatto.' },
  ]);
  await home.locator('#input').fill(`il mio IBAN è ${IBAN}`);
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Segnato il tuo IBAN.' })).toBeVisible({ timeout: 20_000 });
  await home.locator('#input').fill('aprimi la pagina del bonifico con quell\'iban già compilato');
  await home.locator('#sendBtn').click();
  await expect.poll(async () => (await app.evaluate(() => globalThis.__chiamate.length)), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  const ultima = (await app.evaluate(() => globalThis.__chiamate))[2];
  const esiti = ultima.filter((m) => m.role === 'tool').map((m) => String(m.content)).join('\n');
  expect(esiti).not.toMatch(/coordinate bancarie/i);
});
