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

// In headless Linux l'evento `context-menu` del webContents non scatta a ogni
// CDP-simulated right-click (dipende da dbus / X11): usiamo 3 retry a livello
// di test per assorbire la flakiness OS senza mascherare bug reali.
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

  // In headless Linux il CDP-simulated right-click non sempre fa scattare
  // l'evento `context-menu` del webContents (dipende da dbus/X11). Proviamo
  // fino a 5 volte: ogni iterazione chiude il menu Filo e riapre. Il test
  // termina appena il contatore supera 0 (via expect.poll con timeout breve
  // nel loop), o fallisce dopo tutti i tentativi con il messaggio diagnostico.
  const MAX_CLICKS = 5;
  let menuVisible = false;
  for (let i = 0; i < MAX_CLICKS; i++) {
    await page.mouse.click(box.x + 20, box.y + 24, { button: 'right' });
    try {
      await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 3000 });
      menuVisible = true;
    } catch (_) {
      // menu non apparso in questo tentativo: riprova
      continue;
    }
    // Controlla se l'evento è già scattato dopo questo click.
    const count = await app.evaluate(() => globalThis.__ctxCount);
    if (count > 0) break;
    // Menu visibile ma evento non ancora scattato: chiudi e riprova.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
  }

  // Il menu Filo custom si è aperto almeno una volta (nessuna regressione al menu).
  expect(menuVisible, 'il menu Filo non si è aperto: regressione al menu contestuale').toBe(true);

  // E l'evento nativo è scattato almeno una volta: senza il fix (preventDefault)
  // sarebbe sempre 0 perché preventDefault blocca l'emissione dell'evento.
  await expect.poll(
    () => app.evaluate(() => globalThis.__ctxCount),
    { timeout: 4000, message: 'l\'evento context-menu del webContents non è scattato: il canale dei suggerimenti nativi è chiuso (preventDefault?)' },
  ).toBeGreaterThan(0);
});
