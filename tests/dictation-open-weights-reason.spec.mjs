// #461 — con «solo modelli a pesi aperti» acceso, la dettatura si FERMA
// DICENDO PERCHÉ.
//
// I sostituti a pesi aperti leggono testo (e immagini): nessuno sa ascoltare un
// audio. La dettatura quindi non può essere spostata su di loro — ma fermarsi
// non basta: la lettura ad alta voce e l'indicizzazione, nella stessa
// situazione, dicono quale funzione si è fermata e come rimetterla in piedi,
// mentre la dettatura mostrava l'errore generico "il fornitore non risponde",
// che manda a cercare un guasto dove non c'è.
//
// ASSERISCE IL SUCCESSO della spiegazione: l'avviso in pagina nomina i pesi
// aperti. Precondizione (senza il fix): la richiesta verrebbe servita da un
// modello sordo oppure fallirebbe con l'avviso generico → l'assert è rosso.
//
// La registrazione vera non è simulabile (serve un microfono): microfono e
// registratore sono finti, ma tutto il resto — la richiesta al main, la
// politica, l'avviso mostrato — è il codice di produzione.

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

  // Configurazione personale controllata: la dettatura parte da un modello
  // proprietario che avrebbe un equivalente aperto — solo che quell'equivalente
  // l'audio non lo sente.
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      openWeightsOnly: true,
      apiKeys: { openrouter: 'k-test', gemini: 'k-test' },
      modelRegistry: { ...C.DEFAULT_MODEL_REGISTRY },
      models: { [C.ACTIONS.TRANSCRIBE_AUDIO]: 'flash, flash-or' },
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

  // Microfono e registratore finti: emettono un WAV vero e minuscolo (silenzio),
  // così il riencoding fa il suo mestiere e la richiesta parte davvero.
  await page.evaluate(() => {
    function wavBlob() {
      const rate = 8000; const samples = 800;
      const buf = new ArrayBuffer(44 + samples * 2);
      const view = new DataView(buf);
      const put = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
      put(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); put(8, 'WAVE');
      put(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, 1, true); view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      put(36, 'data'); view.setUint32(40, samples * 2, true);
      return new Blob([buf], { type: 'audio/wav' });
    }
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
    class FakeRecorder {
      constructor() { this.mimeType = 'audio/wav'; window.__filoRec = this; }
      static isTypeSupported() { return false; }  // → costruttore senza mimeType
      start() {}
      stop() {
        if (this.ondataavailable) this.ondataavailable({ data: wavBlob() });
        if (this.onstop) this.onstop();
      }
    }
    window.MediaRecorder = FakeRecorder;
  });

  // Il menu del tasto destro cattura il campo su cui si detta.
  await page.locator('#input').focus();
  await page.locator('#input').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.SN_TTS.startDictation());
  await page.waitForFunction(() => !!window.__filoRec, null, { timeout: 5_000 });
  await page.evaluate(() => window.__filoRec.stop());

  // L'avviso nomina il motivo: si può agire (spegnere l'interruttore o dare a
  // questa funzione un modello capace) invece di credere a un guasto di rete.
  const avviso = page.locator('.sn-toast', { hasText: /pesi aperti/i });
  await expect(avviso).toBeVisible({ timeout: 10_000 });
  await expect(avviso).toContainText(/Dettatura/i);
});
