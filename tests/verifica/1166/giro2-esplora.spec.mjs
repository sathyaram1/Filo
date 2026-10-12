// Verifica #1166, giro 2: esplorazione delle strade della segnalazione (più foto in più messaggi, foto senza testo,
// turno fallito e risposta dopo, chat riaperta guardata nei due temi).

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
        const err = new Error('OpenRouter 402: Insufficient credits');
        err.status = 402;
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
      const cv = new OffscreenCanvas(64, 64);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 64, 64);
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
const testi = (msgs) => msgs.map((m) => (typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n'))).join('\n');

test('foto in due messaggi diversi: al quarto messaggio le ha tutte e due, senza nota che dica il contrario', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await preparaModello(app, [{ text: 'Vedo ceci.' }, { text: 'Bene.' }, { text: 'Vedo farina.' }, { text: 'Ceci e farina.' }]);
  const home = await apriHome(openTab);
  await incollaFoto(home, ['#c0392b']);
  await scrivi(home, 'cosa vedi?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Vedo ceci' })).toBeVisible({ timeout: 15_000 });
  await scrivi(home, 'quanti sono?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Bene' })).toBeVisible({ timeout: 15_000 });
  await incollaFoto(home, ['#2e86c1']);
  await scrivi(home, 'e qui?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Vedo farina' })).toBeVisible({ timeout: 15_000 });
  await scrivi(home, 'cosa posso cucinare con le due cose?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Ceci e farina' })).toBeVisible({ timeout: 15_000 });
  const c = await chiamate(app);
  expect(c.map(fotoTot)).toEqual([1, 1, 2, 2]);
  for (const msgs of c) expect(testi(msgs)).not.toContain('non hai più davanti');
});

test('foto mandata senza testo: al messaggio dopo il modello la vede ancora', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModello(app, [{ text: 'Una dispensa.' }, { text: 'Tre barattoli.' }]);
  const home = await apriHome(openTab);
  await incollaFoto(home, ['#27ae60']);
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Una dispensa' })).toBeVisible({ timeout: 15_000 });
  await scrivi(home, 'quanti barattoli?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Tre barattoli' })).toBeVisible({ timeout: 15_000 });
  const [primo, secondo] = await chiamate(app);
  expect(fotoTot(primo)).toBe(1);
  expect(fotoTot(secondo)).toBe(1);
  expect(testi(secondo)).not.toContain('non hai più davanti');
});

test('primo turno fallito (crediti finiti), poi l\'utente risponde: la foto c\'è, una volta sola', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModello(app, [{ text: 'Vedo ceci.' }], { guastiPrima: 5 });
  const home = await apriHome(openTab);
  await incollaFoto(home, ['#8e44ad']);
  await scrivi(home, 'cosa vedi?');
  await home.waitForTimeout(4000);
  await app.evaluate(() => { globalThis.__guasti = 0; });
  await scrivi(home, 'riprova');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Vedo ceci' })).toBeVisible({ timeout: 20_000 });
  const c = await chiamate(app);
  expect(fotoTot(c[c.length - 1])).toBe(1);
});

test('chat riaperta con le foto: aspetto nei due temi', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModello(app, [{ text: 'Vedo ceci e farina.' }]);
  const home = await apriHome(openTab);
  await incollaFoto(home, ['#c0392b', '#2e86c1']);
  await scrivi(home, 'cosa vedi in queste due foto della dispensa?');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Vedo ceci' })).toBeVisible({ timeout: 15_000 });
  await home.screenshot({ path: 'tests/.shots/1166-g2-dal-vivo.png' });
  const id = await app.evaluate(async () => (await globalThis.SN_FILO_CHATS.list()).map((c) => c.id).find(Boolean));
  await home.goto(`filo://newtab/?chat=${encodeURIComponent(id)}`);
  await expect(home.locator('.dash-bubble-user img.dash-bubble-img')).toHaveCount(2, { timeout: 15_000 });
  await home.emulateMedia({ colorScheme: 'light' });
  await home.screenshot({ path: 'tests/.shots/1166-g2-riaperta-chiaro.png' });
  await home.emulateMedia({ colorScheme: 'dark' });
  await home.screenshot({ path: 'tests/.shots/1166-g2-riaperta-scuro.png' });
  // Una delle due tolta (tetto), l'altra resta: la nota dice «un'altra».
  await app.evaluate((_e, id) => globalThis.SN_CONTESTO_FILO.dimentica(id), id);
  await home.goto(`filo://newtab/?chat=${encodeURIComponent(id)}`);
  await expect(home.locator('.dash-bubble-note', { hasText: 'non conservate' })).toBeVisible({ timeout: 15_000 });
  await home.screenshot({ path: 'tests/.shots/1166-g2-riaperta-persa.png' });
});
