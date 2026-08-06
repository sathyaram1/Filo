// VERIFICA TEMPORANEA #406 — parte 3: correttore ortografico dentro un blocco isolato.
import { test, expect } from './fixtures/electron.mjs';

async function sendNative(app, host, word, suggestions) {
  return app.evaluate(({ webContents }, { host, word, suggestions }) => {
    const targets = webContents.getAllWebContents().filter((w) => {
      try { return new URL(w.getURL()).host === host; } catch { return false; }
    });
    for (const wc of targets) wc.send('filo:broadcast', { type: '_spell:native', word, suggestions });
    return targets.length;
  }, { host, word, suggestions });
}

const PAGE = (inner) => `<!doctype html><html><body style="margin:0">
  <div id="host"></div>
  <script>
    const r = document.querySelector('#host').attachShadow({ mode: 'open' });
    r.innerHTML = ${JSON.stringify(inner)};
  </script>
</body></html>`;

const TA = '<textarea id="ta" spellcheck="true" style="font:16px monospace;padding:8px;width:400px;height:120px">ciiao come stai</textarea>';
const CE = '<div id="ce" contenteditable="true" spellcheck="true" style="font:16px monospace;padding:8px;width:400px;height:120px">ciiao come stai</div>';

async function run({ app, openTab, testServer }, inner, sel) {
  const url = testServer.html(PAGE(inner));
  const page = await openTab(url);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const sent = await sendNative(app, new URL(url).host, 'ciiao', ['ciao', 'chiao']);
  expect(sent).toBeGreaterThanOrEqual(1);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoNativeWord === 'ciiao', null, { timeout: 8000 });
  const box = await page.locator(sel).boundingBox();
  await page.mouse.click(box.x + 16, box.y + 16, { button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  const corr = page.locator('.sn-menu-correction:visible');
  await expect(corr.first()).toBeVisible({ timeout: 4000 });
  await expect(corr.first()).toContainText('ciao');
  await page.screenshot({ path: `tests/.shots/v406-spell-${sel.slice(1)}.png` }).catch(() => {});
}

test('correzione in cima su textarea dentro un blocco isolato', async (f) => {
  await run(f, TA, '#ta');
});

test('correzione in cima su campo editabile dentro un blocco isolato', async (f) => {
  await run(f, CE, '#ce');
});
