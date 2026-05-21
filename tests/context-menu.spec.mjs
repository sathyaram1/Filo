// Menu contestuale Filo iniettato dal page-preload.
// Verifichiamo:
//   1. tasto destro su pagina http → .sn-menu compare
//   2. Shift + tasto destro → escape hatch (NON appare .sn-menu)
//   3. tasto destro su selezione → menu mostra la sezione inline AI

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo test page</h1>
  <p id="paragraph">Questa è una frase di prova abbastanza lunga da poter essere selezionata e spiegata da Filo.</p>
  <textarea id="ta" rows="3" cols="40">Testo modificabile</textarea>
</body></html>`;

test('tasto destro apre il menu Filo', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('#paragraph').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
});

test('Shift + tasto destro NON apre il menu (escape hatch)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.keyboard.down('Shift');
  await page.locator('#paragraph').click({ button: 'right' });
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  await expect(page.locator('.sn-menu')).toHaveCount(0);
});

test('tasto destro su selezione mostra la sezione inline AI', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.evaluate(() => {
    const p = document.querySelector('#paragraph');
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.locator('#paragraph').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-inline')).toBeVisible();
});
