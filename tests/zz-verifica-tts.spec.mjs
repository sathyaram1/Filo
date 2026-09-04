import { test, expect } from './fixtures/electron.mjs';
import { openrouterKey, useOwnModels } from './zz-verifica-helpers.mjs';

const HTML = `<!doctype html><html lang="it"><body>
<p id="target">Buongiorno. Questa è una prova di lettura ad alta voce. Filo legge questo testo con una voce naturale.</p>
</body></html>`;

test('lettura ad alta voce dal vivo: audio dal modello via router, non Google', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const key = openrouterKey();
  expect(key).toBeTruthy();
  await useOwnModels(app, key);
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    const orig = P.synthesizeSpeech;
    globalThis.__zzTts = [];
    P.synthesizeSpeech = async (args) => {
      const t0 = Date.now();
      try {
        const r = await orig(args);
        globalThis.__zzTts.push({ model: args.model, voice: args.voice, ok: true, bytes: r.audioBase64.length, mime: r.mimeType, gen: r.generationId, ms: Date.now() - t0 });
        return r;
      } catch (e) {
        globalThis.__zzTts.push({ model: args.model, ok: false, err: String(e.message || e) });
        throw e;
      }
    };
  });
  const page = await testServer.openReady(openTab, HTML);
  await page.evaluate(() => {
    const el = document.getElementById('target');
    const range = document.createRange(); range.selectNodeContents(el);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  });
  await page.locator('#target').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  await menu.locator('.sn-menu-label', { hasText: 'Leggi' }).first().click();

  // Il modello risponde con audio vero.
  await expect.poll(() => app.evaluate(() => globalThis.__zzTts.length), { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(() => app.evaluate(() => globalThis.__zzTts.filter((x) => x.ok).length), { timeout: 60_000 }).toBeGreaterThan(0);
  const calls = await app.evaluate(() => globalThis.__zzTts);
  console.log('TTS CALLS', JSON.stringify(calls));
  expect(calls[0].model).toBe('hexgrad/kokoro-82m');
  expect(calls.find((c) => c.ok).bytes).toBeGreaterThan(2000);

  // Nessun toast di ripiego sulla voce del browser.
  const toasts = await page.evaluate(() => Array.from(document.querySelectorAll('.sn-toast, [class*="toast"]')).map((e) => e.textContent));
  console.log('TOASTS', JSON.stringify(toasts));
  expect(toasts.join(' ')).not.toMatch(/voce del browser/i);

  // Un <audio> con i byte del modello sta suonando.
  const audio = await page.evaluate(() => Array.from(document.querySelectorAll('audio')).map((a) => ({ src: (a.src || '').slice(0, 30), paused: a.paused, t: a.currentTime })));
  console.log('AUDIO', JSON.stringify(audio));

  // Sta leggendo davvero (audio del modello in riproduzione).
  const busy = await page.evaluate(() => window.SN_TTS && window.SN_TTS.ttsBusy && window.SN_TTS.ttsBusy());
  console.log('BUSY', busy);
  // Chi ha servito la voce: lo chiedo io al router con lo stesso id.
  const served = await app.evaluate(async ({}, gen) => {
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    const s = await globalThis.SN_STORAGE.getSettings();
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      try { const r = await P.lookupServedBy({ apiKey: s.apiKeys.openrouter, generationId: gen }); if (r) return r; } catch (e) { return { err: String(e.message) }; }
    }
    return null;
  }, calls[0].gen);
  console.log('SERVED BY', JSON.stringify(served));
  expect(String(served && served.servedBy || '')).not.toMatch(/google/i);
  // Il costo della lettura arriva dal router qualche secondo dopo.
  console.log('COSTS', await app.evaluate(async () => JSON.stringify(await globalThis.SN_COSTS.getMonthly())));
  const hist = await app.evaluate(async () => (await globalThis.SN_HISTORY.list()).filter((x) => x.action === 'tts').length);
  console.log('HISTORY tts entries', hist);
});

test('preferenze: anteprima della voce del modello', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const key = openrouterKey();
  await useOwnModels(app, key);
  const page = await openTab('filo://preferences');
  await page.waitForTimeout(1500);
  const sec = page.locator('#ttsModelVoice');
  await sec.scrollIntoViewIfNeeded().catch(() => {});
  const opts = await page.locator('#ttsModelVoice option').allTextContents();
  console.log('VOICES', JSON.stringify(opts));
  await page.screenshot({ path: process.env.TEMP + '/zz-prefs-voce.png' });
  const btn = page.locator('#ttsModelPreview');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect.poll(() => page.locator('#ttsModelPreviewStatus').textContent(), { timeout: 60_000 }).not.toBe('');
  const st = await page.locator('#ttsModelPreviewStatus').textContent();
  console.log('PREVIEW STATUS', st);
  await page.waitForTimeout(3000);
  console.log('PREVIEW STATUS 2', await page.locator('#ttsModelPreviewStatus').textContent());
});
