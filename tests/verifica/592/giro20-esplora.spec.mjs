// Esplorazione del giro 20 (#592): conferme da digitare dopo l'invio in chat,
// aspetto delle Preferenze e del popup nei due temi.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState } from '../../helpers/confirm.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function configureModel(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
  });
}

async function fakeProvider(app, giri, ritardo = 0) {
  await app.evaluate(async (_electron, { g, ritardo }) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__g20_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const sys = (messages.find((m) => m.role === 'system') || {}).content || '';
      if (!String(sys).includes('═══ CONTENUTO ESTERNO ═══')) return { ...base, text: 'NULLA DA IMPARARE', toolCalls: [], finishReason: 'stop' };
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      if (ritardo) await new Promise((r) => setTimeout(r, ritardo));
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { ...base, text: giro.text || '', toolCalls: calls, finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, { g: giri, ritardo });
}

test('dopo l’invio in chat, «conferma» battuto nel popup da digitare finisce nel suo campo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fakeProvider(app, [
    { toolCalls: [{ id: 'm1', name: 'CANCELLA_MEMORIA', arguments: '{}' }] },
    { text: 'Fatto.' },
  ], 800);
  await page.locator('#input').click();
  await page.keyboard.type('dimentica tutto quello che sai di me', { delay: 20 });
  await page.keyboard.press('Enter');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  const s0 = await confirmState(page);
  expect(s0.hasInput).toBe(true);
  await page.waitForTimeout(300);
  await page.keyboard.type('conferma', { delay: 60 });
  const s1 = await confirmState(page);
  const chat = await page.locator('#input').inputValue();
  await page.screenshot({ path: 'tests/.shots/g20-conferma-da-digitare.png' });
  console.log('popup dopo «conferma»:', JSON.stringify({ okDisabled: s1 && s1.okDisabled, chat }));
  expect(chat, '«conferma» è finito nel campo della chat').toBe('');
  expect(s1.okDisabled, '«conferma» non è arrivato al campo del popup').toBe(false);
});

for (const tema of ['light', 'dark']) {
  test(`aspetto: Preferenze con stile lungo e popup dello stile, tema ${tema}`, async ({ app, shell, openTab }) => {
    test.setTimeout(60_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const stile = Array.from({ length: 12 }, (_, i) => `Regola ${i + 1}: rispondi in modo breve, dammi del tu e usa esempi concreti.`).join('\n');
    await app.evaluate(async (_e, { stile, tema }) => {
      await globalThis.SN_STORAGE.updateSettings({ theme: tema, agentStyle: stile });
      await globalThis.SN_FILO_MEMORY.saveLesson?.('L’utente non beve caffè.');
    }, { stile, tema });
    const prefs = await openTab('filo://preferences/preferences.html');
    await prefs.waitForSelector('#agentStyleText', { timeout: 8_000 });
    await prefs.locator('#agentStyleText').scrollIntoViewIfNeeded();
    await prefs.waitForTimeout(400);
    await prefs.screenshot({ path: `tests/.shots/g20-prefs-${tema}.png` });

    const page = await newtabPage(app);
    await configureModel(app);
    await fakeProvider(app, [
      { toolCalls: [{ id: 's1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'stile_agente', valore: 'Rispondi breve e dammi del tu.' }) }] },
      { text: 'Ok.' },
    ]);
    await shell.locator('.tab').first().click();
    await page.locator('#input').fill('scrivimi breve');
    await page.locator('#sendBtn').click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `tests/.shots/g20-popup-${tema}.png` });
  });
}
