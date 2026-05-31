import { test, expect } from './fixtures/electron.mjs';

// Spellcheck: il menu del tasto destro su una parola errata deve mostrare la
// correzione come PRIMA voce, sia in <textarea> sia in contenteditable.
// (Feedback alpha gRrZZ: "dovrebbe comparire un suggerimento per correggere in
// alto come prima opzione".)
//
// In test non c'è chiave LLM, quindi la correzione proviene dai suggerimenti
// NATIVI: li iniettiamo dal main via wc.send('filo:broadcast') esattamente come
// fa l'evento context-menu di Electron in produzione.

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
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1',
    null, { timeout: 8000 },
  );

  const sent = await sendNative(app.app, new URL(url).host, 'ciiao', ['ciao', 'chiao']);
  expect(sent).toBe(true);
  await page.waitForTimeout(150);

  const box = await page.locator(selector).boundingBox();
  await page.mouse.click(box.x + 16, box.y + 16, { button: 'right' });

  await expect(page.locator('.sn-menu')).toBeVisible();
  const corr = page.locator('.sn-menu-correction:visible');
  await expect(corr.first()).toBeVisible({ timeout: 4000 });
  await expect(corr.first()).toContainText('ciao');
}

test('right-click su parola errata in textarea mostra correzione in cima', async (fx) => {
  await expectCorrectionAtTop(fx, TA_PAGE, '#ta');
});

test('right-click su parola errata in contenteditable mostra correzione in cima', async (fx) => {
  await expectCorrectionAtTop(fx, CE_PAGE, '#ce');
});
