// Richieste utente:
//   1. Includere nel picker anche i modelli NON di testo (TTS, immagini, …),
//      etichettati per categoria e ordinati col più recente in cima.
//   2. Sintesi vocale (lettura ad alta voce) via MODELLO TTS, con la voce del
//      browser come fallback finale.
//   3. Validazione: non poter assegnare a una funzione un modello dalla capacità
//      sbagliata (es. un modello di sola sintesi vocale a una funzione di testo).
//
// I test asseriscono il COMPORTAMENTO atteso (non l'assenza di un errore).

import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

async function revealAdvanced(page) {
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#modelsGrid .sn-chain', { timeout: 6_000 });
  await page.waitForSelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)', { timeout: 6_000 });
}

// Cella dell'editor "Modelli per azione" individuata dal testo della sua label.
function actionCell(page, labelText) {
  return page.locator('#modelsGrid > div').filter({ hasText: labelText });
}

test('Capacità: la validazione modello↔funzione è corretta (main process)', async ({ app }) => {
  const r = await app.evaluate(() => {
    const Caps = globalThis.SN_MODEL_CAPS;
    const A = globalThis.SN_CONST.ACTIONS;
    const m = (p, id, a) => Caps.modelMatchesAction(p, id, a).ok;
    return {
      textOnText: m('gemini', 'gemini-2.0-flash', A.EXPLAIN),
      ttsOnText: m('gemini', 'gemini-2.5-flash-preview-tts', A.EXPLAIN),
      ttsOnTts: m('gemini', 'gemini-2.5-flash-preview-tts', A.TTS),
      textOnTts: m('gemini', 'gemini-2.0-flash', A.TTS),
      gemmaOnImage: m('gemini', 'gemma-4-31b-it', A.DESCRIBE_IMAGE),
      geminiOnImage: m('gemini', 'gemini-2.0-flash', A.DESCRIBE_IMAGE),
      hasSynth: typeof globalThis.SN_PROVIDER_OPENROUTER.synthesizeSpeech === 'function',
    };
  });
  expect(r.textOnText).toBe(true);
  expect(r.ttsOnText).toBe(false);   // TTS non può servire una funzione di testo
  expect(r.ttsOnTts).toBe(true);
  expect(r.textOnTts).toBe(false);   // un modello di testo non può fare TTS
  expect(r.gemmaOnImage).toBe(false); // gemma non accetta immagini in input
  expect(r.geminiOnImage).toBe(true);
  expect(r.hasSynth).toBe(true);     // il provider espone la sintesi vocale
});

test('Picker: i modelli sono etichettati per categoria e ordinati per recency', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  const info = await page.evaluate(() => {
    const opts = [...document.getElementById('models-list-gemini').options];
    const find = (v) => opts.find((o) => o.value === v);
    return {
      values: opts.map((o) => o.value),
      ttsLabel: find('gemini-2.5-flash-preview-tts')?.label || '',
      flashLabel: find('gemini-2.0-flash')?.label || '',
    };
  });

  // Categoria mostrata come label dell'opzione.
  expect(info.ttsLabel).toBe('Sintesi vocale');
  expect(info.flashLabel).toContain('Testo');

  // Più recente in cima: gemini-3.1-* prima di gemini-2.0-*.
  const i31 = info.values.indexOf('gemini-3.1-flash-lite');
  const i20 = info.values.indexOf('gemini-2.0-flash');
  expect(i31).toBeGreaterThanOrEqual(0);
  expect(i20).toBeGreaterThan(i31);
});

test('Validazione: il dropdown disabilita i modelli non adatti alla funzione', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  // Funzione di testo (Spiega): il modello TTS è disabilitato, quelli di testo no.
  // Ogni segmento ha il suo popup → scopo al PRIMO segmento (quello a fuoco).
  const explainSeg = actionCell(page, 'Spiega (inline)').locator('.sn-chain-seg').first();
  await explainSeg.locator('.sn-chain-input').focus();
  const explainPop = explainSeg.locator('.sn-chain-pop');
  await expect(explainPop).toBeVisible({ timeout: 4_000 });
  await expect(explainPop.locator('.sn-select-option[data-value="tts"]')).toHaveClass(/sn-disabled/);
  await expect(explainPop.locator('.sn-select-option[data-value="flash"]')).not.toHaveClass(/sn-disabled/);

  // Funzione TTS (lettura ad alta voce): solo i modelli TTS sono abilitati.
  const ttsSeg = actionCell(page, 'Lettura ad alta voce').locator('.sn-chain-seg').first();
  await ttsSeg.locator('.sn-chain-input').focus();
  const ttsPop = ttsSeg.locator('.sn-chain-pop');
  await expect(ttsPop).toBeVisible({ timeout: 4_000 });
  await expect(ttsPop.locator('.sn-select-option[data-value="tts"]')).not.toHaveClass(/sn-disabled/);
  await expect(ttsPop.locator('.sn-select-option[data-value="flash"]')).toHaveClass(/sn-disabled/);
});

test('Validazione: assegnare un modello TTS a una funzione di testo è bloccato e non salvato', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  const seg = actionCell(page, 'Spiega (inline)').locator('.sn-chain-seg').first();
  const input = seg.locator('.sn-chain-input');
  await input.fill('tts');     // fill emette anche `change` → scatta il gate
  await page.keyboard.press('Tab'); // blur per sicurezza

  // Compare il messaggio di blocco e il valore viene ripristinato (non 'tts').
  await expect(seg.locator('.sn-chain-msg')).toBeVisible({ timeout: 4_000 });
  await expect(input).not.toHaveValue('tts');

  const savedExplain = await page.evaluate(async () => {
    const s = await window.SN_STORAGE.getSettings();
    return s.models[window.SN_CONST.ACTIONS.EXPLAIN] || '';
  });
  expect(savedExplain).not.toContain('tts');
});

test('TTS: l\'azione di sintesi vocale degrada con grazia senza chiave (fallback)', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  // Senza chiave Gemini configurata nei test, il main non può sintetizzare:
  // deve tornare { ok:false } così il content script ripiega sulla voce del
  // browser, invece di lanciare un errore.
  const res = await page.evaluate(async () => {
    return chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.TTS_SYNTH, text: 'ciao' });
  });
  expect(res).toBeTruthy();
  expect(res.ok).toBe(false);
});

test('TTS: il ripiego alla voce del browser è annunciato una volta sola (firstFallback)', async ({ openTab }) => {
  // L'utente lamenta "modello impostato ma lettura automatica": senza chiave il
  // main non può usare la voce a modello e la lettura ripiega su quella del
  // browser. Il content script deve poter AVVISARE l'utente del perché — ma una
  // volta sola per sessione. Il main marca solo il PRIMO ripiego con
  // firstFallback:true; i successivi con false (deduplica), finché una sintesi
  // non riesce. Qui (nessuna chiave Gemini) ogni tentativo ripiega.
  const page = await openTab(OPTIONS_URL);
  const synth = () => page.evaluate(() =>
    chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.TTS_SYNTH, text: 'ciao mondo' }));

  const first = await synth();
  const second = await synth();

  // Primo ripiego: annunciato, con un motivo NON vuoto così il content script
  // può dire all'utente cosa fare. Il motivo non è più un codice interno fisso:
  // quando il problema è la configurazione dei modelli (#416) è già la frase per
  // l'utente, marcata da `errorCode`.
  expect(first.ok).toBe(false);
  expect(first.firstFallback).toBe(true);
  expect(String(first.error || '').trim()).not.toBe('');

  // Secondo ripiego consecutivo: NON riannunciato (niente avvisi ripetuti).
  expect(second.ok).toBe(false);
  expect(second.firstFallback).toBe(false);
});

test('TTS: senza un modello di lettura il motivo dice quale funzione manca (#416)', async ({ openTab }) => {
  // Prima, una lettura senza modello ripiegava in silenzio su un modello scritto
  // nel codice (o mandava al provider un nickname inesistente): l'utente vedeva
  // solo "voce del browser" senza sapere perché. Ora il main dice cosa manca, e
  // il content script mostra quella frase.
  const page = await openTab(OPTIONS_URL);
  const res = await page.evaluate(async () => {
    const C = window.SN_CONST;
    await window.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { tts: { provider: 'openrouter', model: 'gemini-2.5-flash-preview-tts' } },
      models: { [C.ACTIONS.TTS]: '' },
    });
    return chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.TTS_SYNTH, text: 'ciao' });
  });

  expect(res.ok).toBe(false);
  expect(res.errorCode).toBe('NO_MODEL_FOR_ACTION');
  // Nomina la funzione scoperta e dove si imposta, invece di un codice interno.
  expect(res.error).toContain('Lettura ad alta voce');
  expect(res.error).toMatch(/Opzioni/i);
});
