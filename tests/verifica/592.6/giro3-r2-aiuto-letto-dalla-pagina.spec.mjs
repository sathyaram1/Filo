// Verifica #592.6 — giro 3, rilievo 2: quello che l'utente scrive all'Aiuto, e quello che l'Aiuto
// gli risponde, il codice della pagina non lo legge.

import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo } from '../../helpers/confirm.mjs';

test('un dato scritto all’Aiuto non arriva alla pagina', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<h2>Pagamento</h2><input id="iban">');
  const host = new URL(page.url()).hostname;
  await nelMondoDiFilo(app, host, `(() => {
    const M = globalThis.SN_MSG.MSG;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => (m && m.type === M.AI_REQUEST)
      ? Promise.resolve({ ok: true, text: JSON.stringify({ text: 'Il campo IBAN è in alto.', status: 'done' }) })
      : orig(m, ...r);
    SN_SIDEBAR.open();
    return 1;
  })()`);
  await page.waitForSelector('.sn-sidebar-input textarea');
  await page.click('.sn-sidebar-input textarea');
  await page.keyboard.type('dove metto il mio IBAN IT60X0542811101000000123456?');
  await page.keyboard.press('Enter');
  await expect.poll(() => nelMondoDiFilo(app, host, "document.querySelector('.sn-sidebar-conv')?.textContent || ''")).toContain('IT60X0542811101000000123456');
  const vistoDallaPagina = await page.evaluate(() => document.documentElement.innerHTML);
  expect(vistoDallaPagina).not.toContain('IT60X0542811101000000123456');
});
