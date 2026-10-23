// Verifica #1344.1, giro 1, rilievo 2: coi crediti finiti la voce dell'immagine resta su «Descrizione…» per sempre.
import { test, expect } from '../../fixtures/electron.mjs';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('r2 immagine copiata coi crediti finiti: la cronologia non promette una descrizione che non arriverà', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    const boom = () => { const e = new Error('OpenRouter 402: {"error":{"message":"Insufficient credits"}}'); e.status = 402; e.provider = 'openrouter'; throw e; };
    globalThis.SN_PROVIDER_OPENROUTER = { ...P, streamComplete: boom, complete: boom };
  });
  const page = await newtabPage(app);
  await page.waitForFunction(() => typeof window.SN_ACTIONS?.pushClipboardEntry === 'function', null, { timeout: 10_000 });
  await page.evaluate((b64) => window.SN_ACTIONS.pushClipboardEntry({ type: 'image', dataUrl: `data:image/png;base64,${b64}`, description: 'Descrizione…' }), PNG_B64);
  await expect(page.locator('.sn-toast .sn-msg-rimedio', { hasText: 'Apri Crediti' })).toBeVisible({ timeout: 15_000 });
  const descrizione = async () => {
    const storia = await page.evaluate(async () => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY }));
    return ((storia && storia.items) || [])[0]?.description || '';
  };
  await expect.poll(descrizione, { timeout: 10_000 }).not.toBe('Descrizione…');
});
