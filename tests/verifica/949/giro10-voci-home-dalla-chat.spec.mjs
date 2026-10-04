// #949 riallineamento: le voci della home arrivate da main (#873) si cambiano e si leggono dalla chat,
// la casella delle Preferenze aperta segue il cambio, e toccarla lì non riscrive le altre voci.

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

async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__v_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__v_tool = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const ultimo = [...messages].reverse().find((m) => m.role === 'tool');
      if (ultimo) globalThis.__v_tool.push(String(ultimo.content || ''));
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

test('nascondi la batteria nella home dalla chat: Preferenze aperta la segue, la lettura dice il vero, la casella la rimette', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
      homeSistema: { bluetooth: false },
    });
  });
  const impostazioni = () => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
  const prefs = await openTab('filo://preferences/preferences.html');
  await expect(prefs.locator('#homeSisBatteria')).toBeChecked({ timeout: 8_000 });
  await expect(prefs.locator('#homeSisBluetooth')).not.toBeChecked();

  await modelloFinto(app, [
    { toolCalls: [{ id: 'i1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'batteria_home', valore: false }) }] },
    { text: 'Fatto.' },
  ]);
  await chat.bringToFront();
  await chat.locator('#input').fill('togli la batteria dalla home');
  await chat.locator('#sendBtn').click();
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await impostazioni()).homeSistema, { timeout: 5_000 })
    .toEqual({ ora: true, batteria: false, rete: true, bluetooth: false, volume: true });
  const esito = (await app.evaluate(() => globalThis.__v_tool)).pop();
  expect(esito).toContain('Home → nascondi la batteria');

  await prefs.bringToFront();
  await expect(prefs.locator('#homeSisBatteria')).not.toBeChecked({ timeout: 3_000 });

  await modelloFinto(app, [
    { toolCalls: [{ id: 'l1', name: 'LEGGI_IMPOSTAZIONI', arguments: JSON.stringify({ cerca: 'batteria' }) }] },
    { text: 'Letto.' },
  ]);
  await chat.bringToFront();
  await chat.locator('#input').fill('la batteria compare nella home?');
  await chat.locator('#sendBtn').click();
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Letto.' })).toBeVisible({ timeout: 10_000 });
  expect((await app.evaluate(() => globalThis.__v_tool)).pop()).toContain('- voce «batteria» nella home: nascosta [chiave batteria_home]');

  // La casella della pagina rimette la batteria senza toccare il Bluetooth spento.
  await prefs.bringToFront();
  await prefs.locator('#homeSisBatteria').check();
  await expect.poll(async () => (await impostazioni()).homeSistema, { timeout: 5_000 })
    .toEqual({ ora: true, batteria: true, rete: true, bluetooth: false, volume: true });
  await app.evaluate(() => { try { globalThis.__v_restore?.(); } catch (_) {} });
});
