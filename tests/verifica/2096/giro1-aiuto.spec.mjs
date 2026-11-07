// Verifica #2096 giro 1: nell'Aiuto sui siti Copia e Rispondi sotto domanda e risposta, senza muovere la chat.
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

const PAGINA = '<!doctype html><title>Guida</title><h1>Guida</h1><p>Testo della guida.</p>';

async function prepara(app, risposte) {
  await app.evaluate(async (_e, risposte) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    let n = 0;
    const risposta = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: '{}' };
      const text = JSON.stringify({ text: risposte[Math.min(n, risposte.length - 1)], status: 'done' });
      n += 1;
      try { onDelta && onDelta(text); } catch (_) {}
      return { ...base, text };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = risposta;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = risposta;
  }, risposte);
}

const foto = (aiuto) => aiuto.evaluate(() => {
  const host = [...document.querySelectorAll('*')].find((n) => n.shadowRoot && n.shadowRoot.querySelector('.sn-sidebar-conv'));
  const root = host ? host.shadowRoot : document;
  const c = root.querySelector('.sn-sidebar-conv');
  return {
    alte: [...c.querySelectorAll('.sn-sidebar-msg')].map((m) => Math.round(m.getBoundingClientRect().height * 100) / 100),
    larga: c.clientWidth, scrollTop: c.scrollTop, scrollHeight: c.scrollHeight,
  };
});

test('Aiuto: hover su domanda e risposta mostra Copia senza muovere niente, e Copia copia', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await prepara(app, ['Primo paragrafo della risposta.\n\nSecondo paragrafo che chiude.', 'Seconda risposta.\n\nCon un altro paragrafo.']);
  const sito = await testServer.openReady(openTab, PAGINA);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, sito);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  for (const [i, d] of ['dove trovo il profilo?', 'e le impostazioni?'].entries()) {
    await aiuto.fill('.sn-sidebar-input textarea', d);
    await aiuto.press('.sn-sidebar-input textarea', 'Enter');
    await expect(aiuto.locator('.sn-sidebar-msg-assistant').nth(i)).toBeVisible({ timeout: 20_000 });
  }
  await aiuto.mouse.move(2, 2);
  await aiuto.waitForTimeout(400);
  const base = await foto(aiuto);
  const msgs = aiuto.locator('.sn-sidebar-msg-user, .sn-sidebar-msg-assistant');
  const n = await msgs.count();
  expect(n).toBeGreaterThanOrEqual(4);
  for (let i = n - 1; i >= 0; i -= 1) {
    await msgs.nth(i).hover();
    await aiuto.waitForTimeout(300);
    await expect(msgs.nth(i).locator('.sn-azioni-msg')).toBeVisible();
    expect(await foto(aiuto), `hover sul messaggio ${i}`).toEqual(base);
  }
  await aiuto.screenshot({ path: 'tests/.shots/verifica-2096-aiuto.png' });
  const domanda = aiuto.locator('.sn-sidebar-msg-user', { hasText: 'profilo' });
  await domanda.hover();
  await domanda.locator('.sn-azioni-msg').getByRole('button', { name: 'Copia' }).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('dove trovo il profilo?');
  const risposta = aiuto.locator('.sn-sidebar-msg-assistant').first();
  await risposta.hover();
  await risposta.locator('.sn-azioni-msg').getByRole('button', { name: 'Rispondi' }).click();
  await expect(aiuto.locator('.sn-sidebar-input textarea')).toHaveValue(/^> Primo paragrafo/);
});
