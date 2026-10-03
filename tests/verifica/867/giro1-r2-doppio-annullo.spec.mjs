// Verifica #867, giro 1, rilievo 2: due annulli dello stesso cambio arrivati insieme lasciano il segno in disaccordo con lo stato.

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

async function configura(app, extra = {}) {
  await app.evaluate(async (_e, ex) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
      ...ex,
    });
    await globalThis.SN_REGISTRO_CAMBI.attesa();
    await globalThis.chrome.storage.local.set({ filo_cambi: [] });
  }, extra);
}

async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__finto_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__finto_prompt = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const testo = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      globalThis.__finto_prompt.push(testo);
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
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
const ripristina = (app) => app.evaluate(() => { try { globalThis.__finto_restore?.(); } catch (_) {} });
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const registro = (app) => app.evaluate(async () => {
  await globalThis.SN_REGISTRO_CAMBI.attesa();
  const r = await globalThis.chrome.storage.local.get('filo_cambi');
  return r.filo_cambi || [];
});

async function scrivi(page, testo, risposta) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: risposta })).toBeVisible({ timeout: 10_000 });
}

test('due annulla insieme sullo stesso cambio, poi «rifai»: il segno torna a dire «annulla» col tema di nuovo scuro', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await homeDi(app);
  await configura(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 't1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"tema","valore":"scuro"}' }] },
    { text: 'Fatto.' },
  ]);
  await scrivi(page, 'tema scuro', 'Fatto.');
  const id = (await registro(app)).find((e) => e.via === 'chat').id;
  // Il clic sul segno e l'«annulla» chiesto in chat nello stesso momento.
  await app.evaluate(async (_e, i) => Promise.all([
    globalThis.SN_REGISTRO_CAMBI.annulla(i, { via: 'interfaccia' }),
    globalThis.SN_REGISTRO_CAMBI.annulla(i, { via: 'chat' }),
  ]), id);
  expect((await impostazioni(app)).theme).toBe('light');
  const bolla = page.locator('.dash-bubble-user', { hasText: 'tema scuro' });
  await bolla.hover();
  await expect(bolla.locator('.dash-cambi-annulla')).toHaveText('rifai');
  await bolla.locator('.dash-cambi-annulla').click();
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('dark');
  await bolla.hover();
  await expect(bolla.locator('.dash-cambi-annulla')).toHaveText('annulla');
  await ripristina(app);
});
