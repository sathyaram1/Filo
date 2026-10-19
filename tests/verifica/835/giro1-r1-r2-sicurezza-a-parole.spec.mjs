// Verifica #835 giro 1: bloccare un sito col blocco dei siti spento deve bloccarlo davvero o dirlo (r2).
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

async function configura(app, security) {
  await app.evaluate(async (_e, sec) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
      security: sec,
    });
  }, security);
}

async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    globalThis.__v835_tool = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const ultimo = [...messages].reverse().find((m) => m.role === 'tool');
      if (ultimo) globalThis.__v835_tool.push(String(ultimo.content || ''));
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
const imposta = (chiave, valore, id) => ({
  toolCalls: [{ id, name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave, valore }) }],
});
async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}
const sicurezza = async (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security);

test('r2 «blocca example.org» col blocco dei siti spento: il sito resta aperto e nessuno lo dice', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app, { siteBlock: { enabled: false, blacklist: [] } });
  await modelloFinto(app, [imposta('siti_bloccati', 'aggiungi example.org', 'b1'), { text: 'Fatto.' }]);
  await scrivi(chat, 'blocca example.org');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await sicurezza(app)).siteBlock.blacklist, { timeout: 5_000 }).toEqual(['example.org']);
  const s = await sicurezza(app);
  const esito = (await app.evaluate(() => globalThis.__v835_tool)).join('\n');
  // Successo per l'utente: il sito ora non si apre (blocco acceso), o almeno l'esito gli fa dire che il blocco è spento.
  expect(s.siteBlock.enabled === true || /spent|disattivat/i.test(esito),
    `il sito è in elenco ma il blocco dei siti è spento, e l'esito non lo dice: ${esito}`).toBe(true);
});
