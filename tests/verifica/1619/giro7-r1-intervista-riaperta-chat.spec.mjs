// #1619 giro 7, r1: l'intervista rifatta chiesta in chat conta la riapertura come quella dalle Preferenze.
import { test, expect } from '../../fixtures/electron.mjs';

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}

const riaperte = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  let n = 0;
  for (const ora of Object.values(s.ore || {})) n += ((ora.homePagina || {}).intervista_rifatta || {}).riaperta || 0;
  return n;
});

test('r1 «rifai l\'intervista di benvenuto» in chat conta la riapertura, come il pulsante delle Preferenze', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito') && !u.includes('accoglienza'));
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      n += 1;
      const calls = n === 1 ? [{ id: 'p1', name: 'PULSANTE_PREFERENZE', arguments: JSON.stringify({ pulsante: 'rifai_intervista' }) }] : [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      try { onDelta && onDelta('Ricominciamo da capo.'); } catch (_) {}
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: 'Ricominciamo da capo.', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
    globalThis.__r1_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
  });
  const prima = await riaperte(app);

  await chat.bringToFront();
  await chat.locator('#input').fill('rifai l\'intervista di benvenuto');
  await chat.locator('#sendBtn').click();
  const intervista = await trovaPagina(app, (u) => u.startsWith('filo://newtab') && u.includes('accoglienza=1'), 15_000);
  await expect(intervista.locator('.dash-bubble-filo').first()).toContainText('Ciao, sono Filo', { timeout: 15_000 });

  await expect.poll(() => riaperte(app), { timeout: 8_000 }).toBe(prima + 1);
  await app.evaluate(() => { try { globalThis.__r1_restore?.(); } catch (_) {} });
});
