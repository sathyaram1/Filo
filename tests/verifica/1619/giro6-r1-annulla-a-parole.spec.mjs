// Verifica #1619, giro 6: dopo un ripristino chiesto in chat, «annulla» a parole lascia un pulsante che si legge intero.

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
const chiama = (name, args, text = '', id = 'p1') => ({ text, toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('r1 «annulla» a parole dopo il ripristino: il pulsante da premere non resta appeso a «prima di»', async ({ app, shell }) => {
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
      textScale: 1.2,
    });
  });
  await modelloFinto(app, [chiama('PULSANTE_PREFERENZE', { pulsante: 'ripristina_tutto' }, 'Ok.'), { text: 'Fatto.' }]);
  await scrivi(chat, 'rimetti tutte le impostazioni di serie');
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 8_000 }).toContain('tema: scuro');
  await fillConfirmInput(chat, 'conferma');
  await scrollConfirmToEnd(chat);
  await clickConfirm(chat, 'danger');
  await expect.poll(async () => (await impostazioni(app)).theme, { timeout: 5_000 }).toBe('system');

  await modelloFinto(app, [chiama('ANNULLA_CAMBIO', {}, 'Rimetto.', 'p2'), { text: 'Rimesso.' }]);
  await scrivi(chat, 'annulla, rimetti com\'era');
  const pulsante = chat.locator('.dash-action-btn-primary', { hasText: 'Filo vuole rimettere' }).last();
  await expect(pulsante).toBeVisible({ timeout: 10_000 });
  await chat.screenshot({ path: 'tests/.shots/giro6-annulla-a-parole.png' });
  expect((await pulsante.innerText()).trim()).not.toMatch(/prima di$/);
});
