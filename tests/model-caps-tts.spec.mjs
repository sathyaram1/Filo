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
    const C = globalThis.SN_CONST;
    const A = C.ACTIONS;
    const R = globalThis.SN_TEST_MODELS.registry;
    // Le voci predefinite dichiarano le loro modalità: il controllo le usa.
    const m = (nick, a) => {
      const e = R[nick];
      return Caps.modelMatchesAction(e.provider, e.model, a, C.entryModalities(e, nick)).ok;
    };
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    return {
      textOnText: m('deepseek', A.EXPLAIN),
      ttsOnText: m('kokoro', A.EXPLAIN),
      ttsOnTts: m('kokoro', A.TTS),
      textOnTts: m('deepseek', A.TTS),
      sttOnDictation: m('whisper', A.TRANSCRIBE_AUDIO),
      textOnDictation: m('deepseek', A.TRANSCRIBE_AUDIO),
      embedOnArchive: m('qwen-embed', A.ARCHIVE_EMBED),
      textOnArchive: m('deepseek', A.ARCHIVE_EMBED),
      kimiOnImage: m('kimi', A.DESCRIBE_IMAGE),
      deepseekOnImage: m('deepseek', A.DESCRIBE_IMAGE),
      hasSynth: typeof P.synthesizeSpeech === 'function',
      hasTranscribe: typeof P.transcribe === 'function',
      hasEmbed: typeof P.embed === 'function',
    };
  });
  expect(r.textOnText).toBe(true);
  expect(r.ttsOnText).toBe(false);      // la voce non può servire una funzione di testo
  expect(r.ttsOnTts).toBe(true);
  expect(r.textOnTts).toBe(false);      // un modello di testo non può fare la voce
  expect(r.sttOnDictation).toBe(true);  // chi ascolta va sulla dettatura
  expect(r.textOnDictation).toBe(false);
  expect(r.embedOnArchive).toBe(true);
  expect(r.textOnArchive).toBe(false);
  expect(r.kimiOnImage).toBe(true);     // Kimi legge le immagini
  expect(r.deepseekOnImage).toBe(false); // DeepSeek no
  // Il router sa fare tutti e tre i mestieri che prima erano solo di Google.
  expect(r.hasSynth).toBe(true);
  expect(r.hasTranscribe).toBe(true);
  expect(r.hasEmbed).toBe(true);
});

test('Picker: i modelli sono etichettati per categoria (voce, dettatura, indicizzazione, testo)', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  // La tendina è seminata dal registro (subito) e poi, se la rete c'è, dal
  // catalogo del router: in entrambi i casi le etichette devono dire il mestiere.
  await page.waitForFunction(() => {
    const dl = document.getElementById('models-list-openrouter');
    return !!dl && [...dl.options].some((o) => o.value === 'hexgrad/kokoro-82m');
  }, null, { timeout: 6_000 });
  const info = await page.evaluate(() => {
    const opts = [...document.getElementById('models-list-openrouter').options];
    const find = (v) => opts.find((o) => o.value === v);
    return {
      ttsLabel: find('hexgrad/kokoro-82m')?.label || '',
      sttLabel: find('openai/whisper-large-v3-turbo')?.label || '',
      embedLabel: find('qwen/qwen3-embedding-8b')?.label || '',
      textLabel: find('deepseek/deepseek-v4-flash')?.label || '',
    };
  });

  expect(info.ttsLabel).toBe('Sintesi vocale');
  expect(info.sttLabel).toContain('Dettatura');
  expect(info.embedLabel).toBe('Embedding');
  expect(info.textLabel).toContain('Testo');
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
  await expect(explainPop.locator('.sn-select-option[data-value="kokoro"]')).toHaveClass(/sn-disabled/);
  await expect(explainPop.locator('.sn-select-option[data-value="deepseek-flash"]')).not.toHaveClass(/sn-disabled/);

  // Funzione TTS (lettura ad alta voce): solo i modelli TTS sono abilitati.
  const ttsSeg = actionCell(page, 'Lettura ad alta voce').locator('.sn-chain-seg').first();
  await ttsSeg.locator('.sn-chain-input').focus();
  const ttsPop = ttsSeg.locator('.sn-chain-pop');
  await expect(ttsPop).toBeVisible({ timeout: 4_000 });
  await expect(ttsPop.locator('.sn-select-option[data-value="kokoro"]')).not.toHaveClass(/sn-disabled/);
  await expect(ttsPop.locator('.sn-select-option[data-value="deepseek-flash"]')).toHaveClass(/sn-disabled/);
});

test('Validazione: assegnare un modello TTS a una funzione di testo è bloccato e non salvato', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  const seg = actionCell(page, 'Spiega (inline)').locator('.sn-chain-seg').first();
  const input = seg.locator('.sn-chain-input');
  await input.fill('kokoro');  // fill emette anche `change` → scatta il gate
  await page.keyboard.press('Tab'); // blur per sicurezza

  // Compare il messaggio di blocco e il valore viene ripristinato (non 'kokoro').
  await expect(seg.locator('.sn-chain-msg')).toBeVisible({ timeout: 4_000 });
  await expect(input).not.toHaveValue('kokoro');

  const savedExplain = await page.evaluate(async () => {
    const s = await window.SN_STORAGE.getSettings();
    return s.models[window.SN_CONST.ACTIONS.EXPLAIN] || '';
  });
  expect(savedExplain).not.toContain('kokoro');
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
      modelRegistry: { kokoro: { provider: 'openrouter', model: 'hexgrad/kokoro-82m' } },
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
