// #461 — con «solo modelli a pesi aperti» acceso, una dettatura impostata su un
// modello proprietario che non ha un sostituto capace di ascoltare si FERMA
// DICENDO PERCHÉ.
//
// I sostituti a pesi aperti dei modelli di chat leggono testo (e immagini):
// nessuno sa ascoltare un audio. La dettatura quindi non può essere spostata su
// di loro — ma fermarsi non basta: l'avviso deve nominare la funzione e il
// motivo, invece dell'errore generico "il fornitore non risponde", che manda a
// cercare un guasto dove non c'è.
//
// ASSERISCE IL SUCCESSO della spiegazione: l'avviso in pagina nomina i pesi
// aperti e la dettatura. Precondizione (senza il fix): la richiesta verrebbe
// servita da un modello sordo oppure fallirebbe con l'avviso generico → rosso.
//
// Il microfono è finto (un oscillatore: per il segmentatore è "voce"), ma tutto
// il resto — spezzatura, richiesta al main, politica, avviso — è il codice di
// produzione.

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

test('Dettatura: a pesi aperti si ferma nominando il motivo, non con l\'errore generico', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  // Configurazione personale controllata: la dettatura parte da un modello di
  // chat proprietario, che ha un equivalente aperto — solo che quell'equivalente
  // l'audio non lo sente.
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      openWeightsOnly: true,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...C.DEFAULT_MODEL_REGISTRY },
      models: { ...C.DEFAULT_MODELS, [C.ACTIONS.TRANSCRIBE_AUDIO]: 'claude' },
    });
  });

  const page = await newtabPage(app);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null, { timeout: 8_000 },
  );
  await page.waitForFunction(
    () => typeof window.SN_TTS?.startDictation === 'function', null, { timeout: 8_000 },
  );

  // Microfono finto: un tono continuo, che per il segmentatore è parlato.
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

  // Il menu del tasto destro cattura il campo su cui si detta.
  await page.locator('#input').focus();
  await page.locator('#input').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.SN_TTS.startDictation());
  await expect(page.locator('.sn-dictate-pill')).toBeVisible({ timeout: 5_000 });
  // Un secondo e mezzo di "voce", poi lo stop: la frase rimasta è definitiva e
  // parte la richiesta, che la politica ferma.
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.SN_TTS.stopDictation());

  // L'avviso nomina il motivo: si può agire (spegnere l'interruttore o dare a
  // questa funzione un modello capace) invece di credere a un guasto di rete.
  const avviso = page.locator('.sn-toast', { hasText: /pesi aperti/i });
  await expect(avviso).toBeVisible({ timeout: 15_000 });
  await expect(avviso).toContainText(/Dettatura/i);
});
