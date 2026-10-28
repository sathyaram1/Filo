// Verifica #1619 giro 4, r1: «rimetti l'aspetto di serie» non dice «già di serie» mentre il colore delle schede è ritoccato.

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
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito') && !u.includes('accoglienza'));

async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__pp_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__pp_tool = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const ultimo = [...messages].reverse().find((m) => m.role === 'tool');
      if (ultimo) globalThis.__pp_tool.push(String(ultimo.content || ''));
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}
const premi = (pulsante, text = '', extra = {}, id = 'p1') => ({
  text, toolCalls: [{ id, name: 'PULSANTE_PREFERENZE', arguments: JSON.stringify({ pulsante, ...extra }) }],
});
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());

test('r1 «rimetti tutti i colori di serie» dopo i colori delle schede ritoccati: li rimette, o non dice che è già tutto di serie', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const s = await globalThis.SN_STORAGE.getSettings();
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      tabColor: { ...s.tabColor, saturazione_tab: 0.9, opacita_tab: 0.9 },
    });
  });
  const serie = await app.evaluate(() => globalThis.SN_CONST.DEFAULT_SETTINGS.tabColor);
  await modelloFinto(app, [premi('ripristina_aspetto', ''), { text: 'Fatto.' }]);
  await chat.locator('#input').fill('rimetti tutti i colori di serie');
  await chat.locator('#sendBtn').click();
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 10_000 });
  const esito = (await app.evaluate(() => globalThis.__pp_tool)).join('\n');
  const rimessi = JSON.stringify((await impostazioni(app)).tabColor) === JSON.stringify(serie);
  expect(rimessi || !/già tutto ai valori di serie/.test(esito), `colore delle schede ritoccato, e all'utente arriva: ${esito}`).toBe(true);
});
