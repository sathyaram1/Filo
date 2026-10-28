// #1619 giro 2 — «rimetti tutte le impostazioni di serie» dalla chat promette che «annulla» rimette tutto com'era:
// l'indirizzo del proxy e la chiave del controllo dei siti pericolosi, tolti dal ripristino, devono tornare.
import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm, confirmState, fillConfirmInput, scrollConfirmToEnd } from '../../helpers/confirm.mjs';

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
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
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
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());

test('r1 dopo il ripristino dalla chat, «annulla» sul segno rimette anche l\'indirizzo del proxy e la chiave dei siti pericolosi', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'dark',
      proxy: { datacenter: 'http://utente:segreta@127.0.0.1:9' },
      security: { safeBrowse: { safeBrowsingKey: 'AIza-prova-chiave' } },
    });
  });
  await modelloFinto(app, [
    { text: 'Ti chiedo conferma.', toolCalls: [{ id: 'p1', name: 'PULSANTE_PREFERENZE', arguments: JSON.stringify({ pulsante: 'ripristina_tutto' }) }] },
    { text: 'Fatto.' },
  ]);
  await chat.bringToFront();
  await chat.locator('#input').fill('rimetti tutte le impostazioni di serie');
  await chat.locator('#sendBtn').click();
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 8_000 }).toContain('Si rimette com\'era');
  await fillConfirmInput(chat, 'conferma');
  await scrollConfirmToEnd(chat);
  await clickConfirm(chat, 'danger');
  await expect.poll(async () => (await impostazioni(app)).theme, { timeout: 5_000 }).toBe('system');

  const bolla = chat.locator('.dash-bubble-user', { hasText: 'rimetti tutte le impostazioni di serie' });
  const segno = bolla.locator('.dash-cambi-segno');
  await expect(segno).toBeVisible({ timeout: 5_000 });
  await segno.hover();
  await bolla.locator('.dash-cambi-pop .dash-cambi-annulla').click();
  await expect.poll(async () => (await impostazioni(app)).theme, { timeout: 5_000 }).toBe('dark');
  const dopo = await impostazioni(app);
  expect(dopo.useDefaultModels, 'i modelli scelti a mano tornano').toBe(false);
  expect(dopo.proxy.datacenter, 'l\'indirizzo del proxy torna').toBe('http://utente:segreta@127.0.0.1:9');
  expect(dopo.security.safeBrowse.safeBrowsingKey, 'la chiave dei siti pericolosi torna').toBe('AIza-prova-chiave');
  try { await app.evaluate(() => globalThis.__pp_restore?.()); } catch (_) {}
});
