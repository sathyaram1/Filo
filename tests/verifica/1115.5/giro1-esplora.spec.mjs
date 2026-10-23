// #1115.5 giro 1: i passi della segnalazione (scheda nuova, «portami alla home», il bottone sotto la risposta), con la
// risposta scritta insieme al comando come fanno i modelli veri, il doppio clic, la ricarica e il tema scuro.
import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function configura(app, giri, tema = null) {
  await app.evaluate(async (_electron, { g, tema: t }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    if (t) {
      await globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } },
        { url: 'filo://preferences/preferences.html' });
    }
    let n = 0;
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__chiamate.push(messages.length);
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [],
        finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, { g: giri, tema });
}

const chatDi = (app, testo) => app.evaluate(async (_electron, t) => (await globalThis.SN_IL_FILO.chats())
  .filter((c) => c.messages.some((m) => m.text === t)).map((c) => ({ id: c.id, finita: !!c.finita })), testo);

for (const tema of ['light', 'dark']) {
  test(`passi della segnalazione, risposta insieme al comando, tema ${tema}`, async ({ app, shell }) => {
    test.setTimeout(90_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await expect(page.locator('#input')).toBeVisible();
    await configura(app, [
      { toolCalls: [{ id: 'h1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }], text: 'Sei già qui, nella home.' },
      { text: 'Sei già qui, nella home.' },
      { text: 'Di niente.' },
    ], tema);

    await page.locator('#input').fill('portami alla home');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' }).first()).toBeVisible({ timeout: 10_000 });
    const btn = page.locator('.dash-action-btn', { hasText: 'Chiudi la conversazione' });
    await expect(btn).toHaveCount(1);
    await expect(page.locator('.dash-action-btn', { hasText: /torna alla home/i })).toHaveCount(0);
    await page.screenshot({ path: `tests/.shots/1115.5-prima-${tema}.png` });

    await btn.click();
    await expect(page.locator('.dash-action-btn', { hasText: 'Conversazione chiusa' })).toBeDisabled();
    await expect(page.locator('#input')).toBeFocused();
    // Un secondo clic sul segno (il doppio clic di chi non sa se il primo è arrivato): dove finisce il cursore?
    await page.locator('.dash-action-btn', { hasText: 'Conversazione chiusa' }).click({ force: true });
    globalThis.__fuocoDopoSecondo = await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
    console.log('FUOCO DOPO SECONDO CLIC:', globalThis.__fuocoDopoSecondo);
    await page.locator('#input').focus();
    const [chiusa] = await chatDi(app, 'portami alla home');
    await expect.poll(async () => (await chatDi(app, 'portami alla home'))[0]?.finita).toBe(true);
    await page.screenshot({ path: `tests/.shots/1115.5-chiusa-${tema}.png` });

    await page.locator('#input').fill('grazie');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Di niente.' })).toBeVisible({ timeout: 10_000 });
    const dopo = await chatDi(app, 'grazie');
    expect(dopo).toHaveLength(1);
    expect(dopo[0].id).not.toBe(chiusa.id);
    await page.screenshot({ path: `tests/.shots/1115.5-dopo-${tema}.png` });

    // Ricaricata, la home mostra lo scambio chiuso e continua quello nuovo.
    await page.reload();
    await expect(page.locator('#input')).toBeVisible();
    await expect(page.locator('#bubbles .dash-bubble-user', { hasText: 'portami alla home' })).toHaveCount(1);
    await page.screenshot({ path: `tests/.shots/1115.5-ricaricata-${tema}.png` });
  });
}
