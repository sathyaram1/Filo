import { test, expect } from './fixtures/electron.mjs';

// Spellcheck: il menu del tasto destro su una parola errata deve mostrare la
// correzione come PRIMA voce, sia in <textarea> sia in contenteditable.
// (Feedback alpha gRrZZ: "dovrebbe comparire un suggerimento per correggere in
// alto come prima opzione".)
//
// In test non c'è chiave LLM, quindi la correzione proviene dai suggerimenti
// NATIVI: li iniettiamo dal main via wc.send('filo:broadcast') esattamente come
// fa l'evento context-menu di Electron in produzione.

// Inietta i suggerimenti nativi su TUTTI i webContents con quell'host, non solo
// sul primo: all'apertura di un tab Electron può avere transitoriamente due
// WebContentsView con la stessa URL (uno è quello a cui è agganciata la Page di
// Playwright, l'altro un duplicato/prerender). Un singolo `find()` poteva
// colpire quello sbagliato → il broadcast andava perso e il menu di correzione
// non compariva (la flakiness segnalata). Mandandolo a tutti, quello giusto lo
// riceve sempre. Ritorna il numero di destinatari (>=1 se il tab esiste).
async function sendNative(app, host, word, suggestions) {
  return app.evaluate(({ webContents }, { host, word, suggestions }) => {
    const targets = webContents.getAllWebContents().filter((w) => {
      try { return new URL(w.getURL()).host === host; } catch { return false; }
    });
    for (const wc of targets) wc.send('filo:broadcast', { type: '_spell:native', word, suggestions });
    return targets.length;
  }, { host, word, suggestions });
}

const TA_PAGE = `<!doctype html><html><body style="margin:0">
  <textarea id="ta" spellcheck="true"
    style="font:16px monospace;padding:8px;width:400px;height:120px">ciiao come stai</textarea>
</body></html>`;

const CE_PAGE = `<!doctype html><html><body style="margin:0">
  <div id="ce" contenteditable="true" spellcheck="true"
    style="font:16px monospace;padding:8px;width:400px;height:120px">ciiao come stai</div>
</body></html>`;

async function expectCorrectionAtTop({ app, openTab, testServer }, html, selector) {
  const url = testServer.html(html);
  const page = await openTab(url);
  // `filoContentReady` (non `filoReady`): init() è async e setta `filoReady`
  // PRIMA di registrare il listener `_spell:native` (dopo `await fetchSettings`).
  // Aspettare `filoReady` lasciava una finestra in cui il broadcast nativo veniva
  // perso → menu di correzione flaky. `filoContentReady` garantisce che il
  // listener spellcheck sia attivo.
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentReady === '1',
    null, { timeout: 8000 },
  );

  const sent = await sendNative(app, new URL(url).host, 'ciiao', ['ciao', 'chiao']);
  expect(sent).toBe(true);
  // Attende che il broadcast nativo sia stato EFFETTIVAMENTE registrato (non un
  // timeout fisso): solo allora il click destro troverà i suggerimenti pronti.
  await page.waitForFunction(
    () => document.documentElement.dataset.filoNativeWord === 'ciiao',
    null, { timeout: 8000 },
  );

  const box = await page.locator(selector).boundingBox();
  await page.mouse.click(box.x + 16, box.y + 16, { button: 'right' });

  await expect(page.locator('.sn-menu')).toBeVisible();
  const corr = page.locator('.sn-menu-correction:visible');
  await expect(corr.first()).toBeVisible({ timeout: 4000 });
  await expect(corr.first()).toContainText('ciao');
}

test('right-click su parola errata in textarea mostra correzione in cima', async ({ app, openTab, testServer }) => {
  await expectCorrectionAtTop({ app, openTab, testServer }, TA_PAGE, '#ta');
});

test('right-click su parola errata in contenteditable mostra correzione in cima', async ({ app, openTab, testServer }) => {
  await expectCorrectionAtTop({ app, openTab, testServer }, CE_PAGE, '#ce');
});
