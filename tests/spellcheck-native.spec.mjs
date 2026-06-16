import { test, expect } from './fixtures/electron.mjs';

// Regressione (feedback alpha gRrZZ): dopo il refactor da estensione ad app, il
// suggerimento di correzione NON compariva più in cima al menu del tasto destro
// su una parola errata. Causa storica: il wiring del broadcast `_spell:native`
// (suggerimenti nativi di Electron) era andato perso, quindi getNativeSuggestions
// restava sempre vuoto. Questo test guida il path NATIVO end-to-end su una pagina
// esterna e asserisce che il suggerimento corretto compaia come PRIMA voce.
//
// Determinismo: in test non c'è chiave LLM, quindi la riga di correzione può
// provenire SOLO dai suggerimenti nativi inviati dal main (esattamente come fa
// l'evento `context-menu` di Electron in produzione, via wc.send('filo:broadcast')).
// Senza il wiring (slot nascosto) il test fallisce; con esso la correzione appare.

const PAGE = `<!doctype html><html><body style="margin:0">
  <div id="ce" contenteditable="true" spellcheck="true"
       style="font:16px monospace;padding:8px;width:400px;height:120px">wrlod ciao</div>
</body></html>`;

// Invia il broadcast nativo dal main al webContents della pagina, come fa
// Electron quando l'utente clicca destro su una parola sotto lo zigzag rosso.
async function sendNative(app, host, word, suggestions) {
  return app.evaluate(async ({ webContents }, { host, word, suggestions }) => {
    const wc = webContents.getAllWebContents().find((w) => {
      try { return new URL(w.getURL()).host === host; } catch { return false; }
    });
    if (!wc) return false;
    wc.send('filo:broadcast', { type: '_spell:native', word, suggestions });
    return true;
  }, { host, word, suggestions });
}

test('suggerimento nativo compare in cima al menu su parola errata', async ({ app, openTab, testServer }) => {
  const url = testServer.html(PAGE);
  const page = await openTab(url);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1',
    null, { timeout: 8000 },
  );

  // Pre-popola i suggerimenti nativi per "wrlod" PRIMA del click (così sono già
  // freschi quando il menu si compone, senza dipendere da timing/LLM).
  // Inietta anche via main process (IPC) con attesa generosa per minimizzare
  // la flakiness da race condition nel round-trip.
  const sent = await sendNative(app, new URL(url).host, 'wrlod', ['world', 'word']);
  expect(sent).toBe(true);
  await page.waitForTimeout(300); // attesa più lunga per dare tempo all'IPC

  // Right-click esattamente sopra la parola "wrlod" (inizio del contenteditable).
  const box = await page.locator('#ce').boundingBox();
  await page.mouse.click(box.x + 18, box.y + 16, { button: 'right' });

  await expect(page.locator('.sn-menu')).toBeVisible();

  // Dopo l'apertura del menu, re-inietta il broadcast dal main così il waiter
  // `onNativeSuggestions` (800ms) lo riceve. Questo copre il caso in cui
  // `getNativeSuggestions` era vuoto al momento di comporre il menu.
  await sendNative(app, new URL(url).host, 'wrlod', ['world', 'word']);

  // La riga di correzione deve mostrare il suggerimento nativo "world" in cima.
  const corr = page.locator('.sn-menu-correction:visible');
  await expect(corr.first()).toBeVisible({ timeout: 4000 });
  await expect(corr.first()).toContainText('world');

  // Ed è davvero la prima voce cliccabile del menu.
  const firstIsCorrection = await page.evaluate(() => {
    const menu = document.querySelector('.sn-menu');
    if (!menu) return false;
    const first = Array.from(menu.children).find(
      (c) => !c.classList.contains('sn-menu-sep') && c.style.display !== 'none',
    );
    return !!first && first.classList.contains('sn-menu-correction');
  });
  expect(firstIsCorrection).toBe(true);
});
