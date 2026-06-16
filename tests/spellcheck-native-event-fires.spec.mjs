// Feedback alpha gRrZZ (regressione reale): dopo il refactor da estensione ad
// app dedicata, il suggerimento ortografico in cima al menu del tasto destro non
// compariva più. Causa: il content script chiamava e.preventDefault() sull'evento
// DOM `contextmenu`, e questo IMPEDISCE a Chromium di emettere nel main process
// l'evento `context-menu` del webContents — l'unico che porta `misspelledWord` +
// `dictionarySuggestions` del correttore nativo. Senza quell'evento i broadcast
// `_spell:native` (che alimentano la correzione in cima al menu, come faceva il
// menu nativo di Chrome nella vecchia estensione) non partivano mai in
// produzione: scattavano SOLO nei test che li iniettano a mano.
//
// Questo test guarda il canale alla radice: fa un VERO click destro su una
// pagina e verifica che l'evento `context-menu` del webContents scatti nel main
// process. Prima del fix (preventDefault) NON scatta → 0 eventi → test rosso.
// Dopo il fix (niente preventDefault, solo stopImmediatePropagation) scatta →
// test verde. È indipendente dai dizionari Hunspell (che in CI headless non
// vengono scaricati): asserisce che il canale dei suggerimenti nativi è aperto.

import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><body style="margin:0">
  <div id="ce" contenteditable="true" spellcheck="true" lang="it"
       style="font:24px monospace;padding:10px;width:500px;height:120px">testo</div>
</body></html>`;

// In headless Linux il CDP-simulated right-click non sempre fa scattare
// l'evento `context-menu` del webContents a ogni singolo click (dipende da
// dbus/X11). Usiamo retries a livello di describe per riprovare l'intera
// sequenza fino a 3 volte in stato fresco, senza mascherare bug reali (se
// preventDefault fosse attivo, il test fallirebbe su TUTTI i retry).
test.describe('canale context-menu nativo', () => {
  test.describe.configure({ retries: 3 });

  test('il click destro lascia scattare l\'evento context-menu nativo (canale suggerimenti aperto)', async ({ app, openTab, testServer }) => {
    const url = testServer.html(PAGE);
    const host = new URL(url).host;
    const page = await openTab(url);
    await page.waitForFunction(
      () => document.documentElement.dataset.filoReady === '1',
      null, { timeout: 8000 },
    );

    // Aggancia un contatore sull'evento `context-menu` del webContents del tab.
    await app.evaluate(({ webContents }, host) => {
      globalThis.__ctxCount = 0;
      const wc = webContents.getAllWebContents().find((w) => {
        try { return new URL(w.getURL()).host === host; } catch { return false; }
      });
      if (wc) wc.on('context-menu', () => { globalThis.__ctxCount++; });
    }, host);

    // Vero click destro sul contenuto editabile.
    const box = await page.locator('#ce').boundingBox();
    await page.mouse.click(box.x + 20, box.y + 24, { button: 'right' });

    // Il menu Filo custom si apre comunque (nessuna regressione al menu).
    await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 4000 });

    // Chiudi il menu e riapri: in headless Linux il primo click può essere
    // "sordo" per il context-menu del webContents (evento OS non sempre emesso
    // al primo CDP-simulated right-click). Un secondo click aumenta
    // significativamente l'affidabilità senza cambiare la semantica del test.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.mouse.click(box.x + 20, box.y + 24, { button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 4000 });

    // E l'evento nativo è scattato almeno una volta: senza il fix (preventDefault)
    // sarebbe sempre 0 perché preventDefault blocca l'emissione dell'evento.
    await expect.poll(
      () => app.evaluate(() => globalThis.__ctxCount),
      { timeout: 8000, message: 'l\'evento context-menu del webContents non è scattato: il canale dei suggerimenti nativi è chiuso (preventDefault?)' },
    ).toBeGreaterThan(0);
  });
});
