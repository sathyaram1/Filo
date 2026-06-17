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
// Invia a TUTTI i webContents con quell'host (non solo al primo): all'apertura
// di un tab Electron può avere transitoriamente due WebContentsView con la stessa
// URL, e un singolo `find()` poteva colpire quello sbagliato → broadcast perso →
// test flaky. Vedi la stessa nota in spellcheck.spec.mjs.
async function sendNative(app, host, word, suggestions) {
  return app.evaluate(({ webContents }, { host, word, suggestions }) => {
    const targets = webContents.getAllWebContents().filter((w) => {
      try { return new URL(w.getURL()).host === host; } catch { return false; }
    });
    for (const wc of targets) wc.send('filo:broadcast', { type: '_spell:native', word, suggestions });
    return targets.length;
  }, { host, word, suggestions });
}

test('suggerimento nativo compare in cima al menu su parola errata', async ({ app, openTab, testServer }) => {
  const url = testServer.html(PAGE);
  const page = await openTab(url);
  // `filoContentReady` (non `filoReady`): garantisce che il listener spellcheck
  // sia già registrato — init() è async e setta `filoReady` prima di esso.
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentReady === '1',
    null, { timeout: 8000 },
  );

  // Pre-popola i suggerimenti nativi per "wrlod" e attende che siano stati
  // EFFETTIVAMENTE registrati nel content script prima del click (niente timeout
  // fisso): così sono freschi quando il menu si compone, in modo deterministico.
  const sent = await sendNative(app, new URL(url).host, 'wrlod', ['world', 'word']);
  expect(sent).toBeGreaterThanOrEqual(1);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoNativeWord === 'wrlod',
    null, { timeout: 8000 },
  );

  // Right-click esattamente sopra la parola "wrlod" (inizio del contenteditable).
  const box = await page.locator('#ce').boundingBox();
  await page.mouse.click(box.x + 18, box.y + 16, { button: 'right' });

  await expect(page.locator('.sn-menu')).toBeVisible();

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
