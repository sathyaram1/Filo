// TEMP verifier stress test — contenteditable + edge cases. Removed after run.
import { test, expect } from './fixtures/electron.mjs';

test('CE: dettato atterra sulla posizione VIVA del cursore, non su quella del menu', async ({ app, shell, testServer, openTab }) => {
  const html = `<!doctype html><meta charset=utf8><body>
    <div id="ce" contenteditable="true">Hello world</div>
    <input id="other" value="">
  </body>`;
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => typeof window.SN_ACTIONS?.insertDictatedText === 'function', null, { timeout: 8000 });

  // (1) Simula la cattura all'apertura del menu: cursore all'INIZIO del ce.
  await page.evaluate(() => {
    const ce = document.querySelector('#ce');
    ce.focus();
    const r = document.createRange();
    r.setStart(ce.firstChild, 0); r.setEnd(ce.firstChild, 0);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    // aggancia il contesto come farebbe il menu del tasto destro
    window.SN_CONTENT_TESTHOOK_setCtx?.();
  });
  // capturePasteContext non è esposto: usiamo il vero flusso del menu.
  await page.locator('#ce').click({ button: 'right', position: { x: 5, y: 5 } });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sn-menu')).toHaveCount(0);

  // (2) Durante l'attesa l'utente sposta il cursore alla FINE del ce.
  await page.evaluate(() => {
    const ce = document.querySelector('#ce');
    ce.focus();
    const r = document.createRange();
    r.setStart(ce.firstChild, ce.firstChild.length);
    r.setEnd(ce.firstChild, ce.firstChild.length);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });

  // (3) Arriva la trascrizione.
  await page.evaluate(() => window.SN_ACTIONS.insertDictatedText('DICT '));

  const txt = await page.evaluate(() => document.querySelector('#ce').textContent);
  expect(txt).toContain('world');
  // SUCCESSO: dettato in coda (posizione viva), non davanti a Hello.
  expect(txt.trimEnd().endsWith('DICT') || txt.endsWith('DICT ')).toBeTruthy();
  expect(txt.startsWith('DICT')).toBeFalsy();
});
