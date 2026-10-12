// Verifica #1166, giro 1: le foto che il modello ha ancora davanti si vedono anche dall'utente; molte foto pesanti
// mandate insieme non spariscono tutte al turno dopo.

import { test, expect } from '../../fixtures/electron.mjs';

async function preparaModello(app, copione, { guastiPrima = 0 } = {}) {
  await app.evaluate(async (_e, { copione, guastiPrima }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.__guasti = guastiPrima;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = messages.some((m) => m.role === 'user' && String(m.content).startsWith('═══ CONTESTO DI ADESSO'));
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      if (globalThis.__guasti > 0) {
        globalThis.__guasti--;
        const err = new Error('OpenRouter 502: upstream error');
        err.status = 502;
        throw err;
      }
      globalThis.__chiamate.push(JSON.parse(JSON.stringify(messages)));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      try { onDelta && onDelta(r.text); } catch (_) {}
      return { ...base, text: r.text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { copione, guastiPrima });
}

async function apriHome(openTab, url = 'filo://newtab/') {
  const home = await openTab(url);
  await expect(home.locator('#input')).toBeVisible({ timeout: 10_000 });
  return home;
}

async function incollaFoto(home, colori) {
  await home.evaluate(async (colori) => {
    const dt = new DataTransfer();
    for (const [i, c] of colori.entries()) {
      const cv = new OffscreenCanvas(16, 16);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 16, 16);
      const blob = await cv.convertToBlob({ type: 'image/png' });
      dt.items.add(new File([blob], `foto${i}.png`, { type: 'image/png' }));
    }
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, colori);
  await expect(home.locator('#imgPreviews .dash-img-preview img')).toHaveCount(colori.length, { timeout: 5000 });
}

async function scrivi(home, testo) {
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await home.locator('#input').fill(testo);
  await home.locator('#sendBtn').click();
}

const chiamate = (app) => app.evaluate(() => globalThis.__chiamate);
const fotoTot = (msgs) => msgs.reduce((n, m) => n + (Array.isArray(m.content) ? m.content.filter((p) => p.type === 'image_url').length : 0), 0);


test('r1 chat riaperta nella stessa sessione: la foto che il modello vede ancora la vede anche l\'utente', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModello(app, [{ text: 'Vedo ceci.' }, { text: 'Ancora ceci.' }]);
  const home = await apriHome(openTab);
  await incollaFoto(home, ['#c0392b']);
  await scrivi(home, 'cosa vedi?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Vedo ceci' })).toBeVisible({ timeout: 15_000 });
  const id = await app.evaluate(async () => {
    const l = await globalThis.SN_FILO_CHATS.list();
    const arr = Array.isArray(l) ? l : (l && l.chats) || [];
    return arr.map((c) => c.id).find(Boolean);
  });
  // La stessa chat riaperta (dalla Cronologia, o la home ricaricata), Filo sempre acceso.
  await home.goto(`filo://newtab/?chat=${encodeURIComponent(id)}`);
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Vedo ceci' })).toBeVisible({ timeout: 15_000 });
  await scrivi(home, 'e adesso?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Ancora' })).toBeVisible({ timeout: 15_000 });
  const [, secondo] = await chiamate(app);
  // Il modello ha ancora la foto davanti: l'utente deve poterla vedere, e la chat non deve dirla «non conservata».
  expect(fotoTot(secondo)).toBe(1);
  await expect(home.locator('.dash-bubble-user img')).toHaveCount(1);
  await expect(home.locator('.dash-bubble-note', { hasText: 'non conservat' })).toHaveCount(0);
});

test('r2 cinque foto da telefono mandate insieme: al messaggio dopo il modello ne ha ancora davanti almeno una parte', async ({ app }) => {
  test.setTimeout(90_000);
  await preparaModello(app, [{ text: 'Cinque scaffali.' }, { text: 'Sul terzo ci sono i ceci.' }]);
  await app.evaluate(async () => {
    // Una foto da telefono pesa sui 4 MB: in data URL sono più di 5 milioni di caratteri.
    const foto = (k) => `data:image/jpeg;base64,/9j/${String.fromCharCode(65 + k).repeat(5_400_000)}`;
    const images = [0, 1, 2, 3, 4].map(foto);
    await globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'ecco la dispensa', threadHistory: [], chatId: 'c-dispensa', images });
    await globalThis.SN_HANDLE_FILO_CHAT({
      userMessage: 'cosa c’è sul terzo scaffale?', chatId: 'c-dispensa',
      threadHistory: [{ role: 'user', text: 'ecco la dispensa', images: 5 }, { role: 'filo', text: 'Cinque scaffali.' }],
    });
  });
  const [primo, secondo] = await chiamate(app);
  expect(fotoTot(primo)).toBe(5);
  expect(fotoTot(secondo)).toBeGreaterThan(0);
});
