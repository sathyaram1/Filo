// Feedback #438 — correttore ortografico nelle aree di scrittura "ricche"
// (contenteditable) DENTRO un componente web (shadow DOM), i "blocchi isolati"
// con cui i siti moderni costruiscono le pagine.
//
// Il menu del tasto destro dentro questi blocchi funziona (#406) e nelle
// textarea il suggerimento di correzione compare. In un contenteditable dentro
// il blocco non compariva: per sapere QUALE parola è stata cliccata il
// correttore chiedeva al documento "che carattere c'è in questo punto"
// (caretPositionFromPoint), e quella domanda si ferma al confine dello shadow
// root — torna un punto nel light DOM, fuori dall'editabile. Senza parola il
// menu di correzione non veniva nemmeno preparato: nessun suggerimento, mai.
//
// Gli spec asseriscono il SUCCESSO: la correzione compare come PRIMA voce del
// menu dentro il blocco, esattamente come fuori, e cliccarla corregge davvero il
// testo. Togliendo il ripiego geometrico in spellcheck.js tornano rossi.

import { test, expect } from './fixtures/electron.mjs';

// Consegna i suggerimenti nativi come fa il main sull'evento `context-menu` di
// Electron (tabs.js), così il test è deterministico anche senza chiave LLM.
async function sendNative(app, host, word, suggestions) {
  return app.evaluate(({ webContents }, { host, word, suggestions }) => {
    const targets = webContents.getAllWebContents().filter((w) => {
      try { return new URL(w.getURL()).host === host; } catch { return false; }
    });
    for (const wc of targets) wc.send('filo:broadcast', { type: '_spell:native', word, suggestions });
    return targets.length;
  }, { host, word, suggestions });
}

const CE = '<div id="ce" contenteditable="true" spellcheck="true" '
  + 'style="font:16px monospace;padding:8px;width:400px;height:120px">ciiao come stai</div>';

// Stessa identica area di scrittura due volte: una in chiaro, una dentro il
// blocco isolato. Il confronto è il cuore del feedback.
function pageHtml() {
  return `<!doctype html><html><body style="margin:0;padding:0">
    <div id="light">${CE.replace('id="ce"', 'id="ce-light"')}</div>
    <div id="host"></div>
    <script>
      const r = document.querySelector('#host').attachShadow({ mode: 'open' });
      r.innerHTML = ${JSON.stringify(CE)};
    </script>
  </body></html>`;
}

// Apre il menu col tasto destro sopra la parola "ciiao" e ritorna il menu.
async function rightClickOnWord(page, box) {
  await page.mouse.click(box.x + 16, box.y + 16, { button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu;
}

async function prepare({ app, openTab, testServer }) {
  const url = testServer.html(pageHtml());
  const page = await openTab(url);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const sent = await sendNative(app, new URL(url).host, 'ciiao', ['ciao', 'chiao']);
  expect(sent).toBeGreaterThanOrEqual(1);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoNativeWord === 'ciiao', null, { timeout: 8000 });
  return page;
}

// Rettangolo dell'editabile dentro lo shadow root (i locator normali non lo
// vedono: qui ci interessa solo dove cliccare).
async function shadowBox(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#host').shadowRoot.querySelector('#ce');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

test('area di scrittura ricca dentro un blocco isolato: la correzione è la prima voce del menu', async ({ app, openTab, testServer }) => {
  const page = await prepare({ app, openTab, testServer });

  const menu = await rightClickOnWord(page, await shadowBox(page));
  await page.screenshot({ path: 'tests/.shots/spellcheck-shadow-ce.png' }).catch(() => {});

  const corr = page.locator('.sn-menu-correction:visible');
  await expect(corr.first()).toBeVisible({ timeout: 4000 });
  await expect(corr.first()).toContainText('ciao');

  // Ed è davvero la prima voce cliccabile del menu, come in light DOM.
  const firstIsCorrection = await page.evaluate(() => {
    const m = document.querySelector('.sn-menu');
    if (!m) return false;
    const first = Array.from(m.children).find(
      (c) => !c.classList.contains('sn-menu-sep') && c.style.display !== 'none',
    );
    return !!first && first.classList.contains('sn-menu-correction');
  });
  expect(firstIsCorrection).toBe(true);
  await expect(menu).toBeVisible();
});

test('cliccando la correzione la parola viene sostituita nel testo dentro il blocco', async ({ app, openTab, testServer }) => {
  const page = await prepare({ app, openTab, testServer });

  await rightClickOnWord(page, await shadowBox(page));
  const corr = page.locator('.sn-menu-correction:visible').first();
  await expect(corr).toBeVisible({ timeout: 4000 });
  await corr.click();

  await expect.poll(async () => page.evaluate(
    () => document.querySelector('#host').shadowRoot.querySelector('#ce').textContent,
  ), { timeout: 4000 }).toBe('ciao come stai');
});

test('la stessa area di scrittura in chiaro continua a suggerire (baseline)', async ({ app, openTab, testServer }) => {
  const page = await prepare({ app, openTab, testServer });

  const box = await page.locator('#ce-light').boundingBox();
  await rightClickOnWord(page, box);
  const corr = page.locator('.sn-menu-correction:visible');
  await expect(corr.first()).toBeVisible({ timeout: 4000 });
  await expect(corr.first()).toContainText('ciao');
});
