// #438 — correttore ortografico nelle aree di scrittura "ricche"
// (contenteditable) DENTRO un riquadro incorporato di un'altra origine.
//
// Il menu del tasto destro dentro i riquadri funziona (#405) e nelle textarea
// il suggerimento di correzione compare. In un contenteditable dentro il
// riquadro non compariva: per sapere quale parola è stata cliccata il content
// script chiedeva al documento "che carattere c'è in questo punto"
// (caretPositionFromPoint), e quella domanda non risponde dentro un frame di
// altra origine (hit-test fuori processo). Senza parola, il menu di correzione
// non veniva nemmeno preparato e il suggerimento non appariva mai.
//
// Lo spec asserisce il SUCCESSO: la correzione compare come PRIMA voce del menu
// dentro il riquadro, esattamente come fuori. Rimuovendo il ripiego geometrico
// in spellcheck.js torna rosso.

import { test, expect } from './fixtures/electron.mjs';

const RICH = `<!doctype html><html><body style="margin:0">
  <div id="ce" contenteditable="true" spellcheck="true"
       style="font:16px monospace;padding:8px;width:360px;height:100px">ciiao come stai</div>
</body></html>`;

function outer(src) {
  return `<!doctype html><html><body style="margin:0;padding:0;font:16px sans-serif">
    <div id="ce" contenteditable="true" spellcheck="true"
         style="font:16px monospace;padding:8px;width:360px;height:100px">ciiao come stai</div>
    <iframe id="embed" src="${src}" width="420" height="160" style="border:1px solid #333"></iframe>
  </body></html>`;
}

// Consegna i suggerimenti nativi al frame giusto, come fa il main sull'evento
// `context-menu` di Electron (tabs.js: params.frame.send). `wc.send` da solo
// raggiungerebbe solo il frame principale.
async function sendNativeToAllFrames(app, word, suggestions) {
  return app.evaluate(({ webContents }, { word, suggestions }) => {
    let n = 0;
    for (const wc of webContents.getAllWebContents()) {
      let frames = [];
      try { frames = [wc.mainFrame, ...wc.mainFrame.framesInSubtree]; } catch (_) { frames = []; }
      for (const f of frames) {
        try {
          f.send('filo:broadcast', { type: '_spell:native', word, suggestions });
          n++;
        } catch (_) {}
      }
    }
    return n;
  }, { word, suggestions });
}

// Right-click sopra la parola errata e attesa della riga di correzione.
async function expectCorrection(frame, page, target) {
  const menu = target.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 8000 });
  const corr = target.locator('.sn-menu-correction:visible');
  await expect(corr.first()).toBeVisible({ timeout: 6000 });
  await expect(corr.first()).toContainText('ciao');
  // Ed è davvero la prima voce del menu.
  const firstIsCorrection = await frame.evaluate(() => {
    const menu = document.querySelector('.sn-menu');
    if (!menu) return false;
    const first = Array.from(menu.children).find(
      (c) => !c.classList.contains('sn-menu-sep') && c.style.display !== 'none',
    );
    return !!first && first.classList.contains('sn-menu-correction');
  });
  expect(firstIsCorrection).toBe(true);
}

test('area di scrittura ricca DENTRO il riquadro: il suggerimento compare in cima al menu', async ({ app, openTab, testServer }) => {
  const innerUrl = testServer.html(RICH).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, outer(innerUrl));
  const frameLoc = page.frameLocator('#embed');
  const frame = page.frames().find((f) => f !== page.mainFrame());

  // Prima interazione: monta Filo dentro il riquadro.
  await frameLoc.locator('#ce').click();
  await frame.waitForFunction(
    () => document.documentElement.dataset.filoContentReady === '1',
    null, { timeout: 10000 },
  );

  const sent = await sendNativeToAllFrames(app, 'ciiao', ['ciao']);
  expect(sent).toBeGreaterThanOrEqual(1);
  await frame.waitForFunction(
    () => document.documentElement.dataset.filoNativeWord === 'ciiao',
    null, { timeout: 8000 },
  );

  // Click destro sopra "ciiao" (inizio del contenteditable dentro il riquadro).
  const box = await frameLoc.locator('#ce').boundingBox();
  await page.mouse.click(box.x + 20, box.y + 16, { button: 'right' });

  await expectCorrection(frame, page, frameLoc);
});

test('la stessa area di scrittura FUORI dal riquadro continua a suggerire', async ({ app, openTab, testServer }) => {
  const innerUrl = testServer.html(RICH).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, outer(innerUrl));
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentReady === '1',
    null, { timeout: 10000 },
  );
  const sent = await sendNativeToAllFrames(app, 'ciiao', ['ciao']);
  expect(sent).toBeGreaterThanOrEqual(1);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoNativeWord === 'ciiao',
    null, { timeout: 8000 },
  );
  const box = await page.locator('#ce').boundingBox();
  await page.mouse.click(box.x + 20, box.y + 16, { button: 'right' });
  await expectCorrection(page.mainFrame(), page, page);
});
