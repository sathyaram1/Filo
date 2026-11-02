// Verifica #1434 giro 1, rilievo 1: la fila in cima al tasto destro c'è sempre, col suo «+», anche su un filmato, su un
// audio e in un campo dove si scrive senza testo selezionato.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SITO = `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <video id="vid" width="240" height="120" style="background:#000" controls></video>
  <audio id="aud" controls style="display:block;margin-top:20px"></audio>
  <textarea id="area" style="display:block;margin-top:20px;width:300px;height:60px"></textarea>
  <div id="ricco" contenteditable="true" style="margin-top:20px;border:1px solid #999;padding:6px;min-height:40px"></div>
  </body></html>`;

for (const [nome, sel, prima] of [
  ['su un filmato', '#vid', null],
  ['su un audio', '#aud', null],
  ['in una casella vuota col cursore', '#area', 'clic'],
  ['in un campo ricco vuoto col cursore', '#ricco', 'clic'],
]) {
  test(`r1 ${nome} la fila c'è, col suo «+»`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, SITO);
    if (prima) await page.locator(sel).click();
    await page.locator(sel).click({ button: 'right' });
    const menu = menuDi(page);
    await expect(menu.principale).toBeVisible();
    await expect(menu.locator('.sn-menu-row')).toBeVisible();
    await expect(menu.locator('.sn-menu-row .sn-menu-row-overflow')).toBeVisible();
  });
}
