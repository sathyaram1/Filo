// Verifica #868 giro 10, rilievo 2: un modello della chat con la finestra più piccola di tre giorni di filo.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtabs(app) {
  return app.windows().filter((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
}

async function primaScheda(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [win] = await newtabs(app);
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('r2 con un modello dalla finestra di 32.000 token e tre giorni di filo più lunghi, Filo risponde lo stesso', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await primaScheda(app);
  await app.evaluate(async (_e, ora) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [1, 0.05]) });
    // Venti conversazioni di ieri: circa 250.000 caratteri, sotto il tetto di serie in token.
    const E = globalThis.SN_FILO_EVENTI; const T = E.TIPI; const ev = [];
    const ts = (oreFa, piu = 0) => new Date(ora - oreFa * 3600000 + piu).toISOString();
    for (let c = 0; c < 20; c++) {
      const id = `ieri-${c}`;
      ev.push(E.crea(T.CHAT_APERTA, { chat: id }, { ts: ts(40 - c), dispositivo: 'prova', autore: 'utente' }));
      for (let i = 0; i < 6; i++) {
        ev.push(E.crea(T.MESSAGGIO, { chat: id, msg: { role: 'user', text: `domanda ${c}.${i} ` + 'parole '.repeat(60) } }, { ts: ts(40 - c, i * 60000 + 1000), dispositivo: 'prova', autore: 'utente' }));
        ev.push(E.crea(T.MESSAGGIO, { chat: id, msg: { role: 'filo', text: `risposta ${c}.${i} ` + 'testo della risposta '.repeat(60) } }, { ts: ts(40 - c, i * 60000 + 5000), dispositivo: 'prova', autore: 'filo' }));
      }
    }
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
    // Il fornitore rifiuta oltre la finestra del modello, come fanno tutti (circa 32.000 token).
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = messages.some((m) => m.role === 'user' && String(m.content).startsWith('═══ CONTESTO DI ADESSO'));
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      const n = messages.reduce((s, m) => s + String(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).length, 0);
      if (n > 110000) {
        const e = new Error("This endpoint's maximum context length is 32768 tokens. However, you requested about 70000 tokens. Please reduce the length of the messages.");
        e.status = 400;
        throw e;
      }
      try { onDelta && onDelta('Eccomi.'); } catch (_) {}
      return { ...base, text: 'Eccomi.', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, Date.now());
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  await page.locator('#input').fill('ci sei?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Eccomi.' })).toBeVisible({ timeout: 20_000 });
});
