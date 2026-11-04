// Verifica #1700 giro 2, rilievo 1: ricaricata la home mentre Filo lavora, la risposta alla domanda di prima arriva
// nell'archivio ma non compare nella pagina ricaricata, sopra il seguito tornato nella casella.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

async function copione(app, giri) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await app.evaluate(async (_e, g) => {
    const P = globalThis.SN_PROVIDERS;
    if (!globalThis.__v_orig) globalThis.__v_orig = { stream: P.streamCompleteWithFallback, secca: P.completeWithFallback };
    let n = 0;
    const chat = async ({ attempts, onDelta }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      if (giro.ritardoMs) await new Promise((ok) => setTimeout(ok, giro.ritardoMs));
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
    P.streamCompleteWithFallback = chat;
    // Senza la scheda che l'ha chiesta la chat chiama senza flusso.
    P.completeWithFallback = async (o) => {
      if (Array.isArray(o.tools) && o.tools.length) return chat(o);
      return { model: o.attempts[0].model, provider: o.attempts[0].provider, usage: {}, text: '', toolCalls: [], finishReason: 'stop' };
    };
  }, giri);
}

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    const o = globalThis.__v_orig;
    if (o) { globalThis.SN_PROVIDERS.streamCompleteWithFallback = o.stream; globalThis.SN_PROVIDERS.completeWithFallback = o.secca; }
  }).catch(() => {});
});

function incolla(page) {
  return page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 6; c.height = 6;
    const x = c.getContext('2d'); x.fillStyle = '#0a0'; x.fillRect(0, 0, 6, 6);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'foto.png', { type: 'image/png' }));
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
}

test('r1 ricaricata la home mentre Filo lavora, la risposta alla domanda di prima compare quando arriva', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await copione(app, [{ ritardoMs: 6000, text: 'Risposta alla prima domanda.' }]);
  await page.locator('#input').fill('pensaci a lungo');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#stopBtn')).toBeVisible({ timeout: 5_000 });
  await incolla(page);
  await expect(page.locator('#imgPreviews .dash-img-preview')).toHaveCount(1);
  await page.locator('#input').fill('seguito importante');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-attesa')).toHaveCount(1);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  // Il seguito torna nella casella (questo regge); la domanda di prima resta a schermo.
  await expect(page.locator('#input')).toHaveValue(/seguito importante/, { timeout: 10_000 });
  await expect(page.locator('.dash-bubble-user', { hasText: 'pensaci a lungo' })).toBeVisible();
  // La risposta arriva nell'archivio: deve arrivare anche qui, sotto la sua domanda.
  await expect.poll(() => app.evaluate(async () => {
    const chats = await globalThis.SN_IL_FILO.chats();
    return chats.flatMap((c) => c.messages).some((m) => m.role === 'filo' && m.text === 'Risposta alla prima domanda.');
  }), { timeout: 20_000 }).toBe(true);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta alla prima domanda.' })).toBeVisible({ timeout: 10_000 });
});
