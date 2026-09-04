// Dettatura in diretta: le frasi entrano nel campo MENTRE si parla.
//
// Prima si registrava tutto, si premeva stop, si aspettava, e arrivava un
// blocco unico. Ora il microfono viene spezzato in frasi (una pausa chiude la
// frase): ogni frase va al modello di trascrizione e il testo compare nel
// campo, nel punto dove sta il cursore, senza fermare la dettatura.
//
// ASSERISCE IL SUCCESSO dal punto di vista di chi detta: dopo una prima frase e
// una pausa il testo è già nel campo e la dettatura è ancora accesa; dopo una
// seconda frase il campo ne ha due, nell'ordine detto. Precondizione (col
// vecchio flusso): il campo resta vuoto finché non si ferma la registrazione →
// il primo assert è rosso.
//
// Microfono finto (un tono, che per il segmentatore è voce; la pausa è il tono
// spento); modello di trascrizione finto nel main (risponde "frase N"). Tutto
// il resto — spezzatura, WAV, richiesta, inserimento — è il codice di produzione.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

test('Dettatura: le frasi arrivano nel campo mentre si parla, nell\'ordine detto', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...C.DEFAULT_MODEL_REGISTRY },
      models: { ...C.DEFAULT_MODELS },
    });
    // Modello di trascrizione finto: registra cosa riceve e risponde "frase N".
    globalThis.__dictCalls = [];
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async ({ model, audioBase64, format, language }) => {
      const bytes = Buffer.from(String(audioBase64 || ''), 'base64').length;
      globalThis.__dictCalls.push({ model, bytes, format, language });
      return {
        text: ` frase ${globalThis.__dictCalls.length} `,
        usage: { seconds: bytes / 32000, costUsd: 0.00001 },
        generationId: null,
      };
    };
  });

  const page = await newtabPage(app);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null, { timeout: 8_000 },
  );
  await page.waitForFunction(
    () => typeof window.SN_TTS?.startDictation === 'function', null, { timeout: 8_000 },
  );

  // Microfono finto: un tono acceso/spento a comando.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      osc.frequency.value = 220;
      const gain = ac.createGain();
      gain.gain.value = 0.4;
      const dest = ac.createMediaStreamDestination();
      osc.connect(gain); gain.connect(dest); osc.start();
      try { await ac.resume(); } catch (_) {}
      window.__fakeMic = { ac, osc, gain };
      return dest.stream;
    };
  });
  const voce = (on) => page.evaluate((v) => { window.__fakeMic.gain.gain.value = v ? 0.4 : 0; }, on);
  const campo = () => page.evaluate(() => document.querySelector('#input').value);

  // Il menu del tasto destro cattura il campo su cui si detta.
  await page.locator('#input').focus();
  await page.locator('#input').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.SN_TTS.startDictation());
  const pill = page.locator('.sn-dictate-pill');
  await expect(pill).toBeVisible({ timeout: 5_000 });

  // Prima frase: voce, poi una pausa → il testo entra SUBITO, a dettatura accesa.
  await page.waitForTimeout(1800);
  await voce(false);
  await expect.poll(campo, { timeout: 10_000 }).toMatch(/frase \d+ /);
  await expect(pill).toBeVisible();

  // Seconda frase: si accoda alla prima, nell'ordine detto.
  await voce(true);
  await page.waitForTimeout(1800);
  await voce(false);
  await expect.poll(campo, { timeout: 10_000 }).toMatch(/frase \d+ frase \d+ /);

  // Stop: il riquadro sparisce e il campo resta com'è.
  await page.evaluate(() => window.SN_TTS.stopDictation());
  await expect(pill).toHaveCount(0, { timeout: 10_000 });
  const finale = await campo();
  expect(finale).toMatch(/^frase \d+ frase \d+ /);

  // Il main ha ricevuto spezzoni WAV veri, col modello di dettatura configurato.
  const calls = await app.evaluate(() => globalThis.__dictCalls);
  expect(calls.length).toBeGreaterThanOrEqual(2);
  for (const c of calls) {
    expect(c.format).toBe('wav');
    expect(c.bytes).toBeGreaterThan(44 + 16000); // più di mezzo secondo a 16 kHz
    expect(c.model).toBe('openai/whisper-large-v3-turbo');
  }
});
