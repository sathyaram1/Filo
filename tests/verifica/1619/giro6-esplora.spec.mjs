// Giro 6 di verifica #1619: esplorazione del ripristino chiesto in chat (annulla a parole, annulla del riquadro, pagina aperta).

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

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
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
const chiama = (name, args, text = '', id = 'p1') => ({ text, toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('esplora: ripristino in chat e poi «annulla» a parole', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ theme: 'dark', textScale: 1.2 }));
  await modelloFinto(app, [chiama('PULSANTE_PREFERENZE', { pulsante: 'ripristina_tutto' }, 'Ok.'), { text: 'Fatto.' }]);
  await scrivi(chat, 'rimetti tutte le impostazioni di serie');
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 8_000 }).toContain('tema: scuro');
  console.log('RIQUADRO:', (await confirmState(chat)).text);
  await fillConfirmInput(chat, 'conferma').catch(() => {});
  await scrollConfirmToEnd(chat);
  await clickConfirm(chat, 'danger').catch(() => clickConfirm(chat, 'ok'));
  await expect.poll(async () => (await impostazioni(app)).theme, { timeout: 5_000 }).toBe('system');
  console.log('TOOL1:', await app.evaluate(() => globalThis.__pp_tool.join('\n---\n')));

  await modelloFinto(app, [chiama('ANNULLA_CAMBIO', {}, 'Rimetto.', 'p2'), { text: 'Rimesso.' }]);
  await scrivi(chat, 'annulla, rimetti com\'era');
  await chat.waitForTimeout(3000);
  const st = await confirmState(chat);
  console.log('RIQUADRO2:', st && st.text);
  if (st && st.text) {
    await fillConfirmInput(chat, 'conferma').catch(() => {});
    await scrollConfirmToEnd(chat);
    await clickConfirm(chat, 'danger').catch(() => clickConfirm(chat, 'ok'));
  }
  await chat.waitForTimeout(2000);
  console.log('TOOL2:', await app.evaluate(() => globalThis.__pp_tool.join('\n---\n')));
  const dopo = await impostazioni(app);
  console.log('DOPO:', dopo.theme, dopo.textScale, dopo.useDefaultModels);
  await chat.screenshot({ path: 'tests/.shots/giro6-annulla-a-parole.png' });
  expect(dopo.theme).toBe('dark');
});

test('esplora: annullare il riquadro del ripristino non cambia niente, e richiederlo funziona', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await configura(app);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ useDefaultModels: true }));
  await modelloFinto(app, [chiama('PULSANTE_PREFERENZE', { pulsante: 'ripristina_tutto' }, 'Ok.'), { text: 'Va bene.' }]);
  await scrivi(chat, 'rimetti tutte le impostazioni di serie');
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 8_000 }).toContain('tema: scuro');
  console.log('RIQUADRO-B:', (await confirmState(chat)).text);
  await chat.screenshot({ path: 'tests/.shots/giro6-riquadro-semplice.png' });
  await clickConfirm(chat, 'cancel');
  await chat.waitForTimeout(1500);
  expect((await impostazioni(app)).theme).toBe('dark');
  await modelloFinto(app, [chiama('PULSANTE_PREFERENZE', { pulsante: 'ripristina_tutto' }, 'Ok.', 'p3'), { text: 'Fatto.' }]);
  await scrivi(chat, 'no dai, rimettile');
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 8_000 }).toContain('tema: scuro');
  await scrollConfirmToEnd(chat);
  await clickConfirm(chat, 'ok');
  await expect.poll(async () => (await impostazioni(app)).theme, { timeout: 5_000 }).toBe('system');
  await chat.screenshot({ path: 'tests/.shots/giro6-dopo-ripristino.png' });
});
