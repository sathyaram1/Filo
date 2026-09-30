// Verifica #592.4 giro 1, rilievo 1: con tanti file nell'editor Filo deve
// continuare a vederli tutti in chat, i più recenti compresi (su main li vedeva).
import { test, expect } from '../../fixtures/electron.mjs';

const N = 200;

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('duecento file nell\'editor: in chat Filo vede anche l\'ultimo creato', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async (_e, N) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const riassunto = 'Appunti sulla riunione con il fornitore: i prezzi concordati per il prossimo trimestre, '
      + 'le date di consegna e i punti ancora aperti sul contratto.';
    const files = Array.from({ length: N }, (_, i) => ({
      id: `file-prova-${i}`,
      meta: { title: `Riunione ${i + 1}`, summary: riassunto },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `testo ${i}` }] }] },
    }));
    await chrome.storage.local.set({
      'filo.editor.collection': { version: 2, activeId: files[N - 1].id, files },
      'filo.editor.notesMigrated': true,
    });
    globalThis.__captured = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      globalThis.__captured.push(JSON.parse(JSON.stringify(messages)));
      try { onDelta && onDelta('Ok.'); } catch (_) {}
      return { text: 'Ok.', toolCalls: [], reasoningDetails: [], model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({ text: 'NULLA DA IMPARARE', toolCalls: [], model: attempts[0].model, provider: attempts[0].provider, usage: {} });
  }, N);

  await page.locator('#input').fill('cosa avevo scritto nell\'ultima riunione?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ok.' })).toBeVisible({ timeout: 20_000 });
  const sistema = await app.evaluate(() => globalThis.__captured.find((ms) => ms[0]?.role === 'system')[0].content);
  const visti = new Set((sistema.match(/\[file-prova-\d+\]/g) || []));
  // Il file più recente è quello di cui l'utente chiede per primo.
  expect(sistema).toContain(`[file-prova-${N - 1}]`);
  expect(visti.size).toBe(N);
});
