// Esplorazione della verifica #842: si cancella o si rinomina prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi } from '../../helpers/riquadri.mjs';

const TESTO = `<!doctype html><html><body style="margin:0;padding:16px;font:16px sans-serif">
  <p id="testo">Una frase abbastanza lunga da poterla selezionare, spiegare e tradurre.</p>
  <input id="campo" value="">
  <script>
    window.__visti = [];
    addEventListener('keydown', (e) => { if (e.altKey || e.ctrlKey) window.__visti.push((e.ctrlKey?'c':'')+(e.altKey?'a':'')+(e.shiftKey?'s':'')+'|'+e.key.toLowerCase()); }, true);
  </script>
</body></html>`;

const titolo = async (app, page) => (await statoDi(app, page, '.sn-popup .sn-popup-title'))?.testo || '';

function premi(app, keyCode, modifiers = []) {
  return app.evaluate(({ BrowserWindow }, o) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    const wc = t.view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: o.keyCode, modifiers: o.modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: o.keyCode, modifiers: o.modifiers });
  }, { keyCode, modifiers });
}

const chiedi = (app, valore) => app.evaluate((_e, v) => globalThis.SN_EXECUTE_FILO_ACTION(
  { type: 'IMPOSTA_PREFERENZA', chiave: 'scorciatoia', valore: v }, { sender: null }), valore);

function seleziona(page, selettore) {
  return page.evaluate((sel) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(sel));
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }, selettore);
}

test('pagina già aperta: cambio a caldo, menu e tasti', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TESTO);
  expect((await chiedi(app, 'Traduci: Ctrl+Shift+Y')).executed).toBe(true);
  expect((await chiedi(app, 'Aiuto: Alt+Shift+K')).executed).toBe(true);
  await page.locator('#testo').click();
  await seleziona(page, '#testo');
  await premi(app, 'T', ['alt']);
  await expect.poll(() => page.evaluate(() => window.__visti)).toContain('a|t');
  await premi(app, 'Y', ['control', 'shift']);
  await expect.poll(() => titolo(app, page), { timeout: 8000 }).toBe('Traduzione');
  await page.keyboard.press('Escape');
  await page.locator('#campo').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  console.log('MENU', JSON.stringify(await page.locator('.sn-menu .sn-menu-shortcut').allTextContents()));
});

test('preferenze: clic fuori chiude l\'ascolto e il main torna a prendersi i tasti', async ({ app, openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.locator('#scorciatoieFilo .sc-riga[data-azione="translate-selection"] .sc-tasti').click();
  await expect(page.locator('#scorciatoieFilo .sc-riga[data-azione="translate-selection"]')).toHaveClass(/sc-registra/);
  await page.locator('h1, h2').first().click();
  await expect(page.locator('#scorciatoieFilo .sc-riga[data-azione="translate-selection"]')).not.toHaveClass(/sc-registra/);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return (t.view.webContents._filoRegistraTastiFino || 0) > Date.now();
  })).toBe(false);
});
