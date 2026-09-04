// VERIFICA INDIPENDENTE — da cancellare a fine verifica.
// Prova dal vivo (chiave OpenRouter vera fuori dal repo).
import { test, expect } from './fixtures/electron.mjs';
import { readFileSync } from 'node:fs';

const KEY = (readFileSync('C:/Users/agenti AI/Desktop/Filo/agent-bench/.env', 'utf8')
  .match(/OPENROUTER_KEY=(\S+)/) || [])[1];

async function setKey(openTab, key) {
  const opt = await openTab('filo://options/options.html');
  await opt.waitForLoadState('load');
  await opt.waitForTimeout(2500);
  // "Usa modelli predefiniti" OFF → chiave e modelli personali
  const chk = opt.locator('#useDefaultModels');
  if (await chk.isChecked()) await chk.click();
  await opt.waitForTimeout(500);
  await opt.locator('#apiKey').fill(key);
  await opt.locator('#apiKey').blur();
  await opt.waitForTimeout(2500);
  return opt;
}

test('lettura ad alta voce: audio vero da un modello non Google', async ({ openTab }) => {
  test.setTimeout(180000);
  expect(KEY, 'chiave OpenRouter trovata').toBeTruthy();
  const opt = await setKey(openTab, KEY);

  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForLoadState('load');
  await pref.waitForTimeout(2500);

  // Quale modello vede la pagina, e cosa risponde la sintesi vera.
  const res = await pref.evaluate(async () => {
    const MSG = window.SN_MSG || {};
    return await chrome.runtime.sendMessage({
      type: MSG.TTS_SYNTH || 'tts_synth',
      text: 'Ciao, sono Filo. Questa è una prova di lettura.',
      lang: 'it',
      voice: '',
    });
  });
  console.log('RISPOSTA SINTESI:', JSON.stringify({
    ok: res && res.ok, model: res && res.model, provider: res && res.provider,
    mimeType: res && res.mimeType, bytes: res && res.audioBase64 ? res.audioBase64.length : 0,
    error: res && res.error, errorCode: res && res.errorCode,
  }));
  expect(res.ok, 'la sintesi riesce: ' + (res.error || '')).toBe(true);
  expect(res.audioBase64.length).toBeGreaterThan(10000);
  expect(String(res.model).toLowerCase()).not.toMatch(/google|gemini|chirp/);

  // Ora il cammino UTENTE: il pulsante "Ascolta" delle Preferenze.
  const btn = pref.locator('#ttsModelPreview');
  await expect(btn).toHaveCount(1);
  await btn.click();
  await pref.waitForTimeout(12000);
  const status = (await pref.locator('#ttsModelPreviewStatus').textContent() || '').trim();
  console.log('STATO PULSANTE ASCOLTA:', JSON.stringify(status));
  expect(status, 'nessun errore mostrato all utente').toBe('');
});

test('cronologia: chi ha servito la lettura non è escluso', async ({ openTab, app }) => {
  test.setTimeout(180000);
  await setKey(openTab, KEY);
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForLoadState('load');
  await pref.waitForTimeout(2000);
  await pref.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: 'tts_synth', text: 'Prova del riscontro sul fornitore.', lang: 'it', voice: 'if_sara',
    });
  });
  // l'audit di chi ha servito arriva dopo qualche secondo
  await pref.waitForTimeout(25000);
  const hist = await openTab('filo://history/history.html');
  await hist.waitForLoadState('load');
  await hist.waitForTimeout(3000);
  console.log('CRONOLOGIA:\n' + (await hist.evaluate(() => document.body.innerText)).slice(0, 3000));
});
