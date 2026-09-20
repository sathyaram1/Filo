// sonda temporanea: osserva il comportamento, non asserisce niente
import { test } from '../../fixtures/electron.mjs';

test.setTimeout(90_000);

test('sidebar: cosa vede l\'utente quando Filo rifiuta', async ({ app, openTab }) => {
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'conservativo' } }));
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 8000 });

  // sporca il compito dallo STESSO mittente della sidebar
  const cerca = await page.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_run_action', action: { type: 'CERCA_WEB', query: 'qualunque cosa' },
  }));
  const grezzo = await page.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_run_action',
    action: { type: 'INVIA_FEEDBACK', testo: 'la ricerca è lenta', titolo: 'lenta' },
  }));
  console.log('CERCA:', JSON.stringify(cerca));
  console.log('RISPOSTA DEL MAIN:', JSON.stringify(grezzo));

  await page.evaluate(() => window.SN_SIDEBAR.open());
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
  const esito = await page.evaluate(async () => window.__filoSidebarTest.runFiloAction({
    type: 'INVIA_FEEDBACK', testo: 'la ricerca è lenta', titolo: 'lenta',
  }));
  const righe = await page.evaluate(() => [...document.querySelectorAll('.sn-sidebar-log')].map((n) => n.textContent));
  const tutto = await page.evaluate(() => document.querySelector('.sn-sidebar-conv')?.textContent || '');
  console.log('ESITO SIDEBAR:', JSON.stringify(esito), 'RIGHE:', JSON.stringify(righe));
  console.log('CONVERSAZIONE:', JSON.stringify(tutto.slice(0, 600)));
});
