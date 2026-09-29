// Verifica #588.5 giro 5, rilievo 1: i tasti laterali del mouse (indietro, avanti) premuti nel vuoto attorno a un
// avviso arrivavano alla pagina sotto come un clic sinistro. Col mouse vero (xdotool, tasti 8 e 9) la pagina riceveva
// mousedown/mouseup/click col tasto 0; qui lo stesso gesto entra nella vista come lo consegna Chromium (button 3 e 4).
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;height:100vh">
  <button id="b" style="position:fixed;left:0;top:0;width:100vw;height:100vh">Elimina</button>
  <script>window.__clic = 0; document.getElementById('b').addEventListener('click', () => { window.__clic++; });</script>
  </body></html>`;

// Preme e rilascia un tasto del mouse nel vuoto a sinistra della carta, dentro la vista degli avvisi.
function premiNelVuoto(vista, button) {
  return vista.evaluate((button) => {
    const r = document.querySelector('.shell-notif.show').getBoundingClientRect();
    const x = Math.max(2, r.left - 6);
    const y = r.top + r.height / 2;
    const el = document.elementFromPoint(x, y);
    const bit = { 0: 1, 1: 4, 2: 2, 3: 8, 4: 16 }[button];
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button, buttons: bit, detail: 1 }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button, buttons: 0, detail: 1 }));
  }, button);
}

test('tasto indietro e tasto avanti nel vuoto accanto a un avviso: la pagina sotto non riceve un clic', async ({ shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await shell.evaluate(() => window.filoNotify('Scaricato: prova.pdf', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);

  await premiNelVuoto(vista, 3);
  await premiNelVuoto(vista, 4);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__clic), 'indietro e avanti non sono un clic sul pulsante della pagina').toBe(0);

  // Controllo: il clic sinistro nello stesso punto arriva alla pagina, quindi il punto è davvero il vuoto.
  await premiNelVuoto(vista, 0);
  await expect.poll(() => page.evaluate(() => window.__clic)).toBe(1);
});
