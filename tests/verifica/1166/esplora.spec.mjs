// Esplorazione del verificatore per #1166: Riprova dopo un guasto, chat riaperta, foto in un'altra chat.

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

test('riprova dopo un guasto: le foto arrivano una volta sola, e al turno dopo ci sono ancora', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModello(app, [{ text: 'Vedo ceci e farina.' }, { text: 'Hummus coi ceci.' }], { guastiPrima: 1 });
  const home = await apriHome(openTab);
  await incollaFoto(home, ['#c0392b', '#2e86c1']);
  await scrivi(home, 'cosa c’è nella dispensa?');
  const riprova = home.locator('button', { hasText: 'Riprova' });
  await expect(riprova).toBeVisible({ timeout: 15_000 });
  await riprova.click();
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Vedo ceci' })).toBeVisible({ timeout: 15_000 });
  await scrivi(home, 'e coi ceci?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Hummus' })).toBeVisible({ timeout: 15_000 });
  const [primo, secondo] = await chiamate(app);
  expect(fotoTot(primo)).toBe(2);
  expect(fotoTot(secondo)).toBe(2);
});

test('chat riaperta nella stessa sessione: il modello vede le foto, e l\'utente?', async ({ app, openTab }) => {
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
  const riaperta = await apriHome(openTab, `filo://newtab/?chat=${encodeURIComponent(id)}`);
  await expect(riaperta.locator('.dash-bubble-filo', { hasText: 'Vedo ceci' })).toBeVisible({ timeout: 15_000 });
  const nota = await riaperta.locator('.dash-bubble-note').allTextContents();
  const imgs = await riaperta.locator('.dash-bubble-user img').count();
  console.log('NOTE RIAPERTA', JSON.stringify(nota), 'IMG', imgs);
  await scrivi(riaperta, 'e adesso?');
  await expect(riaperta.locator('.dash-bubble-filo', { hasText: 'Ancora' })).toBeVisible({ timeout: 15_000 });
  const [, secondo] = await chiamate(app);
  console.log('FOTO AL MODELLO DOPO RIAPERTURA', fotoTot(secondo));
});
