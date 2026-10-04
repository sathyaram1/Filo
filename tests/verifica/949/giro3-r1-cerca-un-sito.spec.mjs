// #949 giro 3, rilievo 1: «ho bloccato facebook.com?» — Filo legge le impostazioni cercando il sito, e la riga
// dei siti bloccati deve tornargli con dentro facebook.com (anche quando l'elenco supera le cento voci).
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
  await app.evaluate(async (_e, x) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry, theme: 'light', ...x,
    });
  }, extra);
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
      const text = giro.text || '';
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (text) { try { onDelta && onDelta(text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, giri);
}
const ripristina = (app) => app.evaluate(() => { try { globalThis.__v_restore?.(); } catch (_) {} });
const esiti = (app) => app.evaluate(() => globalThis.__v_tool || []);
async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

const rigaElenco = (esito) => String(esito || '').split('\n').find((r) => r.includes('domini in blacklist')) || '';
const leggi = (cerca, id) => ({ toolCalls: [{ id, name: 'LEGGI_IMPOSTAZIONI', arguments: JSON.stringify({ cerca }) }] });

test('cercando il sito, la lettura riporta l\'elenco dei siti bloccati che lo contiene', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app, { security: { siteBlock: { blacklist: ['tiktok.com', 'facebook.com'] } } });

  await modelloFinto(app, [leggi('facebook.com', 'l1'), { text: 'Letto.' }]);
  await scrivi(chat, 'ho bloccato facebook.com?');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Letto.' })).toBeVisible({ timeout: 10_000 });
  const breve = (await esiti(app)).join('\n');
  expect(rigaElenco(breve), 'la lettura cercata col nome del sito non mostra l\'elenco dei siti bloccati').toContain('facebook.com');
  await ripristina(app);
});

test('con più di cento siti bloccati, «chiedi con una parola del sito» li fa vedere davvero', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  const tanti = Array.from({ length: 150 }, (_, i) => `sito${i}.it`).concat('facebook.com');
  await configura(app, { security: { siteBlock: { blacklist: tanti } } });

  await modelloFinto(app, [leggi('siti bloccati', 'l1'), leggi('facebook', 'l2'), { text: 'Letto.' }]);
  await scrivi(chat, 'ho bloccato facebook?');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Letto.' })).toBeVisible({ timeout: 10_000 });
  const [primo, secondo] = await esiti(app);
  expect(primo).toContain('chiedi con una parola del sito');
  expect(rigaElenco(secondo), 'chiesto con una parola del sito, facebook.com resta fuori').toContain('facebook.com');
  await ripristina(app);
});
