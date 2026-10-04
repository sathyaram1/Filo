// #949 giro 3, rilievo 2: un sito con lettere accentate aggiunto a parole entra nell'elenco (porta del giro 1)
// e la conferma lo scrive come l'utente lo legge, münchen.de, come fa la pagina Sicurezza.
import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm, confirmState } from '../../helpers/confirm.mjs';

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

test('«blocca münchen.de»: entra nell\'elenco e la conferma dice münchen.de', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await modelloFinto(app, [{ toolCalls: [{ id: 'i1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'siti_bloccati', valore: 'aggiungi münchen.de' }) }] }, { text: 'Fatto.' }]);
  await scrivi(chat, 'blocca münchen.de');
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 10_000 }).toContain('Siti bloccati');
  const testo = (await confirmState(chat)).text;
  await chat.screenshot({ path: 'tests/.shots/verifica-949-giro3-accentato.png' });
  await clickConfirm(chat, 'ok');
  await expect.poll(async () => (await app.evaluate(async () => globalThis.SN_STORAGE.getSettings())).security.siteBlock.blacklist, { timeout: 5_000 })
    .toEqual(['xn--mnchen-3ya.de']);
  const sec = await openTab('filo://security/security.html');
  await expect(sec.locator('#sec-siteblock-blacklist')).toHaveValue('münchen.de', { timeout: 8_000 });
  expect(testo, 'la conferma mostra la forma tecnica del nome').toContain('münchen.de');
  await ripristina(app);
});
