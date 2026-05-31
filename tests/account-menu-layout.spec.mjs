// Feedback alpha rXjvdd: nel menu account (icona profilo nella shell) "la mail
// non è ben centrata nel suo campo" e "l'ombra dei menu finisce in maniera
// brusca e sembra tagliata".
//
// Il menu è un BrowserWindow trasparente generato da src/main/popup-menu.js
// (buildHTML). Questo test rende l'HTML reale del menu account e asserisce:
//   1) la voce email (disabled, senza icona) è centrata orizzontalmente nel menu
//      (margini sinistro/destro ~uguali) e NON va in overflow/ellissi;
//   2) l'ombra (box-shadow) ha spazio sufficiente nel gutter trasparente della
//      finestra, così non viene tagliata di netto dal bordo.

import { test, expect } from './fixtures/electron.mjs';
import { buildHTML } from '../src/main/popup-menu.js';

const EMAIL = 'sathyarampontillo@gmail.com';
const ENTRIES = [
  { label: EMAIL, disabled: true },
  { type: 'separator' },
  { label: 'Esci', icon: 'close', action: 'auth-signout' },
];

test('menu account: email centrata e ombra non tagliata', async ({ app }) => {
  const html = buildHTML(ENTRIES, false, 26);
  const measured = await app.evaluate(async ({ BrowserWindow }, html) => {
    const win = new BrowserWindow({ show: false, width: 260, height: 200, webPreferences: {} });
    await win.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 250));
    const res = await win.webContents.executeJavaScript(`(() => {
      const menu = document.querySelector('.menu');
      const email = document.querySelector('.item.disabled');
      const lbl = email.querySelector('.lbl');
      const mr = menu.getBoundingClientRect();
      const lr = lbl.getBoundingClientRect();
      return {
        menuLeft: mr.left, menuRight: mr.right, menuWidth: mr.width,
        lblLeft: lr.left, lblRight: lr.right,
        lblScrollW: lbl.scrollWidth, lblClientW: lbl.clientWidth,
        marginPx: parseFloat(getComputedStyle(menu).marginLeft),
        boxShadow: getComputedStyle(menu).boxShadow,
      };
    })()`);
    win.destroy();
    return res;
  }, html);

  // 1) Email non troncata: il testo ci sta tutto (niente ellissi).
  expect(measured.lblScrollW, 'email troncata: il campo è troppo stretto').toBeLessThanOrEqual(measured.lblClientW + 1);

  // 2) Email centrata: lo spazio a sinistra e a destra del testo dentro il menu
  // è ~uguale (tolleranza 6px). Prima del fix la colonna icona vuota la spingeva
  // a destra → margini molto sbilanciati.
  const leftGap = measured.lblLeft - measured.menuLeft;
  const rightGap = measured.menuRight - measured.lblRight;
  expect(Math.abs(leftGap - rightGap), `email non centrata (sx=${leftGap.toFixed(1)} dx=${rightGap.toFixed(1)})`).toBeLessThanOrEqual(6);

  // 3) Il gutter trasparente attorno al menu contiene l'ombra: l'offset+blur del
  // box-shadow (0 4px 20px → ~24px sotto) deve stare nel margin della finestra.
  expect(measured.marginPx, 'gutter insufficiente per l\'ombra').toBeGreaterThanOrEqual(24);
});
