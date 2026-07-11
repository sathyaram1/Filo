// AUDIT (routine, riproduzione): la miniatura salvata da "Salva per dopo"
// contiene il menu del tasto destro ancora aperto? Estrae il dataURL della
// thumbnail dell'entry salvata e lo scrive su file per ispezione visiva.

import { test, expect } from './fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';

test('estrai la miniatura salvata per ispezione', async ({ openTab, testServer }) => {
  const url = testServer.html(
    `<!doctype html><html><head><title>Pagina miniatura</title></head>
     <body style="padding:40px;background:#fff">
       <h1>Titolo grande della pagina</h1>
       <p>${'Contenuto della pagina di prova. '.repeat(40)}</p>
     </body></html>`,
  );

  const page = await openTab(url);
  await page.waitForLoadState('domcontentloaded');
  await page.click('body', { button: 'right' });
  const btn = page.locator('.sn-menu [data-sn-icon-id="saveForLater"]');
  await expect(btn).toBeVisible();
  await btn.click();
  await page.waitForTimeout(1500).catch(() => {});

  const home = await openTab('filo://home/home.html');
  await home.waitForLoadState('domcontentloaded');
  await home.waitForTimeout(500);
  const thumb = await home.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_SAVED_PAGES });
    const p = (r && r.pages) || [];
    return p.length ? (p[0].thumbnail || '') : '';
  });
  console.log('THUMB length >>>', thumb.length);
  expect(thumb.startsWith('data:image/')).toBe(true);
  const b64 = thumb.split(',')[1];
  writeFileSync('tests/.shots/audit-saved-thumb.png', Buffer.from(b64, 'base64'));
});
