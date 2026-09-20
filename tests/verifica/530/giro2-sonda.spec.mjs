// sonda temporanea: osserva il comportamento, non asserisce niente
import { test } from '../../fixtures/electron.mjs';

test.setTimeout(90_000);

test('sidebar: cosa vede l\'utente quando Filo rifiuta', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'conservativo' } }));
  const url = testServer.html('<!doctype html><title>Pagina qualunque</title><p>ciao</p>');
  const page = await openTab(url);
  await page.waitForLoadState('load').catch(() => {});

  const grezzo = await page.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_run_action',
    action: { type: 'INVIA_FEEDBACK', testo: 'la ricerca è lenta', titolo: 'lenta' },
  }));
  console.log('RISPOSTA DEL MAIN:', JSON.stringify(grezzo));

  await page.evaluate(() => window.SN_SIDEBAR?.open?.());
  await page.waitForTimeout(500);
  const esito = await page.evaluate(async () => window.__filoSidebarTest.runFiloAction({
    type: 'INVIA_FEEDBACK', testo: 'la ricerca è lenta', titolo: 'lenta',
  }));
  const righe = await page.evaluate(() => [...document.querySelectorAll('.sn-sidebar-log')].map((n) => n.textContent));
  console.log('ESITO SIDEBAR:', JSON.stringify(esito), 'RIGHE:', JSON.stringify(righe));
});
