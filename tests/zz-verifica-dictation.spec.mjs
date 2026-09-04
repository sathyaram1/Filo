import { test, expect } from './fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { openrouterKey, useOwnModels } from './zz-verifica-helpers.mjs';

const HTML = `<!doctype html><html lang="it"><body>
<textarea id="ta" rows="4" cols="60">Nota: </textarea>
</body></html>`;

// Microfono finto: un oscillatore che "parla" a tratti (tono 1,5 s, pausa 1,2 s, tono 1,5 s, silenzio).
async function fakeMic(page) {
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const dest = ctx.createMediaStreamDestination();
      osc.frequency.value = 220;
      osc.connect(gain); gain.connect(dest);
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0.6, t);
      gain.gain.setValueAtTime(0, t + 1.5);
      gain.gain.setValueAtTime(0.6, t + 2.7);
      gain.gain.setValueAtTime(0, t + 4.2);
      osc.start();
      window.__zzMicCtx = ctx;
      return dest.stream;
    };
  });
}

test('dettatura: il testo trascritto entra nel campo, a spezzoni e con provvisorie', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await useOwnModels(app, 'chiave-finta');
  await app.evaluate(() => {
    globalThis.__zzTr = [];
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async ({ model, audioBase64, format, language }) => {
      globalThis.__zzTr.push({ model, bytes: audioBase64.length, format, language });
      const n = globalThis.__zzTr.length;
      return { text: `frase ${n}`, servedBy: 'DeepInfra', generationId: null, usage: { seconds: 1, costUsd: 0.0001 } };
    };
  });
  const page = await testServer.openReady(openTab, HTML);
  await fakeMic(page);
  await page.locator('#ta').click();
  await page.locator('#ta').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  const detta = menu.locator('.sn-menu-label', { hasText: 'Detta' }).first();
  await expect(detta).toBeVisible();
  await detta.click();
  await expect(page.locator('.sn-dictate-pill')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => page.locator('#ta').inputValue(), { timeout: 30_000 }).toMatch(/frase/);
  await page.waitForTimeout(6000);
  const val = await page.locator('#ta').inputValue();
  const calls = await app.evaluate(() => globalThis.__zzTr);
  console.log('TA VALUE', JSON.stringify(val));
  console.log('TRANSCRIBE CALLS', JSON.stringify(calls));
  expect(calls[0].model).toBe('openai/whisper-large-v3-turbo');
  expect(calls[0].format).toBe('wav');
  // Ferma cliccando il riquadro.
  await page.locator('.sn-dictate-pill').click();
  await expect(page.locator('.sn-dictate-pill')).toBeHidden({ timeout: 10_000 });
  const hist = await app.evaluate(async () => (await globalThis.SN_HISTORY.list()).filter((x) => x.action === 'transcribe_audio').map((x) => ({ out: x.output, servedBy: x.servedBy, cost: x.costEur })));
  console.log('HISTORY', JSON.stringify(hist));
  expect(hist.length).toBeGreaterThan(0);
});

test('dettatura dal vivo: whisper via router trascrive un campione parlato', async ({ app }) => {
  test.setTimeout(120_000);
  const key = openrouterKey();
  const wav = readFileSync(process.env.TEMP + '/prova.wav').toString('base64');
  const r = await app.evaluate(async ({}, a) => {
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    const C = globalThis.SN_CONST;
    const routing = { ignore: C.providerIgnoreList ? C.providerIgnoreList(C.DEFAULT_EXCLUDED_PROVIDERS) : C.DEFAULT_EXCLUDED_PROVIDERS };
    const out = {};
    for (const model of ['openai/whisper-large-v3-turbo', 'nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b']) {
      const t0 = Date.now();
      try {
        const res = await P.transcribe({ apiKey: a.key, model, audioBase64: a.wav, format: 'wav', language: 'it', providerRouting: routing });
        let later = null;
        for (let i = 0; i < 6 && !later; i++) {
          await new Promise((r) => setTimeout(r, 4000));
          try { later = await P.lookupServedBy({ apiKey: a.key, generationId: res.generationId }); } catch (e) { later = { err: String(e.message) }; }
        }
        out[model] = { text: res.text, servedBy: res.servedBy, gen: res.generationId, usage: res.usage, later, ms: Date.now() - t0 };
      } catch (e) {
        out[model] = { error: String(e.message || e) };
      }
    }
    return out;
  }, { key, wav });
  console.log('LIVE TRANSCRIBE', JSON.stringify(r, null, 1));
  expect(r['openai/whisper-large-v3-turbo'].text || '').toMatch(/prova/i);
});

test('dettatura dal vivo in app: campione parlato inviato come dettatura', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const key = openrouterKey();
  await useOwnModels(app, key);
  const wavB64 = readFileSync(process.env.TEMP + '/prova.wav').toString('base64');
  const page = await testServer.openReady(openTab, HTML);
  // Microfono finto che riproduce il campione parlato, poi silenzio.
  await page.evaluate((b64) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const buf = await ctx.decodeAudioData(bytes.buffer);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const dest = ctx.createMediaStreamDestination();
      src.connect(dest);
      src.start();
      window.__zzMicCtx = ctx;
      return dest.stream;
    };
  }, wavB64);
  await page.locator('#ta').click();
  await page.locator('#ta').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await menu.locator('.sn-menu-label', { hasText: 'Detta' }).first().click();
  await expect(page.locator('.sn-dictate-pill')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => page.locator('#ta').inputValue(), { timeout: 60_000 }).toMatch(/prova/i);
  const val = await page.locator('#ta').inputValue();
  console.log('LIVE TA VALUE', JSON.stringify(val));
  await page.locator('.sn-dictate-pill').click();
  await expect(page.locator('.sn-dictate-pill')).toBeHidden({ timeout: 15_000 });
  await page.waitForTimeout(12000);
  const hist = await app.evaluate(async () => (await globalThis.SN_HISTORY.list()).filter((x) => x.action === 'transcribe_audio').map((x) => ({ out: x.output, model: x.model, servedBy: x.servedBy, violation: x.policyViolation, cost: x.costEur })));
  console.log('LIVE HISTORY', JSON.stringify(hist));
  expect(hist.length).toBeGreaterThan(0);
  expect(String(hist[0].servedBy || '')).not.toMatch(/google/i);
});
