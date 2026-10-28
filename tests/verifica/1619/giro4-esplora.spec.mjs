// Verifica #1619 giro 4: il ripristino dalla chat rimette com'era anche gli elenchi e le scelte dell'utente.

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

test('esplora: il ripristino dalla chat e il suo annullo, con elenchi e scelte dell\'utente', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const s = await globalThis.SN_STORAGE.getSettings();
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'dark',
      blocklist: ['esempio.com', 'altro.it'],
      contatori: { attivi: false },
      documenti: { cartelle: [...s.documenti.cartelle, '~/Progetti'] },
      tabColor: { ...s.tabColor, opacita_tab: 0.5 },
      themeTokens: { accent: '#2f6b3a' },
      agentStyle: 'Rispondi in rima',
      terminal: { ...s.terminal, enabled: true },
      security: { ...s.security, siteBlock: { ...s.security.siteBlock, blacklist: ['brutto.com'] },
        cookies: { ...s.security.cookies, trustedSites: ['banca.it'] } },
    });
  });
  const prima = await impostazioni(app);

  await modelloFinto(app, [premi('ripristina_tutto', 'Ti chiedo conferma.'), { text: 'Fatto.' }]);
  await chat.bringToFront();
  await chat.locator('#input').fill('rimetti tutte le impostazioni di serie');
  await chat.locator('#sendBtn').click();
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 8_000 }).toContain('tema: scuro');
  const testo = (await confirmState(chat)).text;
  console.log('POPUP:\n' + testo);
  await chat.screenshot({ path: 'tests/.shots/v1619-g4-popup.png' });
  await fillConfirmInput(chat, 'conferma').catch(() => {});
  await scrollConfirmToEnd(chat);
  await clickConfirm(chat, 'danger').catch(async () => clickConfirm(chat, 'ok'));
  await expect.poll(async () => (await impostazioni(app)).theme, { timeout: 5_000 }).toBe('system');
  const dopo = await impostazioni(app);
  console.log('DOPO contatori', JSON.stringify(dopo.contatori), 'blocklist', JSON.stringify(dopo.blocklist));

  const bolla = chat.locator('.dash-bubble-user', { hasText: 'rimetti tutte le impostazioni di serie' });
  const segno = bolla.locator('.dash-cambi-segno');
  await expect(segno).toBeVisible({ timeout: 5_000 });
  await segno.hover();
  await chat.screenshot({ path: 'tests/.shots/v1619-g4-segno.png' });
  await bolla.locator('.dash-cambi-pop .dash-cambi-annulla').click();
  await expect.poll(async () => (await impostazioni(app)).theme, { timeout: 5_000 }).toBe('dark');
  const tornato = await impostazioni(app);
  const diff = [];
  (function walk(a, b, p) {
    for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
      const x = a?.[k]; const y = b?.[k]; const q = p ? `${p}.${k}` : k;
      if (x && typeof x === 'object' && !Array.isArray(x)) walk(x, y, q);
      else if (JSON.stringify(x) !== JSON.stringify(y)) diff.push(`${q}: ${JSON.stringify(x)} -> ${JSON.stringify(y)}`);
    }
  })(prima, tornato, '');
  console.log('DIFF dopo annulla:\n' + diff.join('\n'));
  expect(diff).toEqual([]);
});
