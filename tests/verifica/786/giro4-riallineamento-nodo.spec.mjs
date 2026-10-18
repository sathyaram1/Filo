// #786 giro 4 (riallineamento): «aggiornati» in chat lascia nel filo dell'attesa il suo nodo intitolato, e la carta
// della versione nuova resta. Prova senza rilievo: la porta del riallineamento, ri-provata e chiusa.

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
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));

async function aggiornatoreFinto(app) {
  await app.evaluate(async () => {
    const ascolta = {};
    const u = {
      autoDownload: true, autoInstallOnAppQuit: true, scaricamenti: 0,
      on(e, f) { (ascolta[e] ||= []).push(f); return u; },
      emit(e, ...a) { for (const f of ascolta[e] || []) f(...a); },
      async checkForUpdates() {
        u.emit('update-available', { version: '9.9.9' });
        return { downloadPromise: u.autoDownload ? u.downloadUpdate() : null };
      },
      checkForUpdatesAndNotify() { return u.checkForUpdates(); },
      downloadUpdate() { u.scaricamenti += 1; return new Promise(() => {}); },
    };
    globalThis.__aggFinto = u;
    await globalThis.SN_STORAGE.updateSettings({ aggiornamenti: { automatici: false } });
    await globalThis.__filoUpdater.avviaAggiornatore(u, {
      automatici: false, annuncia: () => globalThis.__filoHandlers.broadcastLiveUpdate(),
    });
  });
}

async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '',
        toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, giri);
}

test('«aggiornati» in chat: il filo dell\'attesa fa il nodo «Avviato l\'aggiornamento» e lo scaricamento parte', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await aggiornatoreFinto(app);
  await expect(chat.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'versione 9.9.9' })).toBeVisible({ timeout: 8_000 });

  await modelloFinto(app, [
    { toolCalls: [{ id: 'i1', name: 'INSTALLA_AGGIORNAMENTO', arguments: '{}' }] },
    { text: 'La scarico: si installa quando chiudi Filo.' },
  ]);
  await chat.bringToFront();
  await chat.locator('#input').fill('aggiornati');
  await chat.locator('#sendBtn').click();
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'si installa quando chiudi Filo' })).toBeVisible({ timeout: 10_000 });
  expect(await app.evaluate(() => globalThis.__aggFinto.scaricamenti)).toBe(1);

  const activity = chat.locator('.dash-activity').last();
  await expect(activity.locator('.dash-activity-label')).toContainText(/aggiornamento|versione nuova/i);
  await activity.locator('.dash-activity-head').click();
  await expect(activity.locator('.dash-activity-seg-head', { hasText: 'Avviato l\'aggiornamento' })).toBeVisible({ timeout: 5_000 });
  await chat.screenshot({ path: 'tests/agent/.out/verifica-786-giro4-nodo.png' });
});
