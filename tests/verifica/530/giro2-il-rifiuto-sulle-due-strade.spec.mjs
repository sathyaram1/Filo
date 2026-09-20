// Verifica #530, giro 2 — un rifiuto dice sempre cosa fare adesso? Sulle due
// strade che Filo offre per la stessa cosa.
//
// Il giro 1 aveva chiuso il vicolo cieco della chat: quando la regola dice di
// no, la risposta porta con sé il motivo e la via d'uscita. L'Aiuto — il
// pannello che si apre SULLA pagina — chiama lo stesso motore e riceve la
// stessa spiegazione, ma all'utente ne mostra una riga sola: «non riuscita».
//
// Qui si guarda cosa legge l'utente sulle due strade, con lo stesso rifiuto.

import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(90_000);

const exec = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

const setLivello = (app, livello) =>
  app.evaluate((_e, l) => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: l } }), livello);

const FEEDBACK = { type: 'INVIA_FEEDBACK', testo: 'la ricerca è lenta', titolo: 'ricerca lenta' };

test('in chat il rifiuto porta il motivo e la strada', async ({ app }) => {
  await setLivello(app, 'conservativo');
  const s = { tab: { id: 9620, url: 'filo://dashboard/dashboard.html' }, url: 'filo://dashboard/dashboard.html' };
  await exec(app, { type: 'CERCA_WEB', query: 'qualunque cosa' }, { sender: s });
  const r = await exec(app, FEEDBACK, { sender: s });
  expect(r.rejected).toBe(true);
  expect(String(r.error)).toMatch(/ho letto/i);
  expect(String(r.error)).toMatch(/Preferenze/);
});

test('PORTA: nel pannello Aiuto lo stesso rifiuto diventa «non riuscita», e basta', async ({ app, openTab }) => {
  await setLivello(app, 'conservativo');
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 8000 });

  // Lo stesso compito dell'Aiuto legge qualcosa scritto da altri.
  await page.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_run_action', action: { type: 'CERCA_WEB', query: 'qualunque cosa' },
  }));

  // Il motore, interrogato dalla stessa pagina, la spiegazione ce l'ha.
  const dalMotore = await page.evaluate(async (a) => chrome.runtime.sendMessage({
    type: 'filo_run_action', action: a,
  }), FEEDBACK);
  expect(dalMotore.rejected, 'a questo livello, con un compito sporco, il feedback non deve partire').toBe(true);
  expect(String(dalMotore.error), 'il motore deve dire il motivo e la strada').toMatch(/Preferenze/);

  // Quello che l'utente legge davvero nel pannello.
  await page.evaluate(() => window.SN_SIDEBAR.open());
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
  await page.evaluate(async (a) => window.__filoSidebarTest.runFiloAction(a), FEEDBACK);
  const scritto = await page.evaluate(
    () => [...document.querySelectorAll('.sn-sidebar-log')].map((n) => n.textContent).join('\n'),
  );

  expect(scritto, 'il pannello deve pur dire che non è andata').toMatch(/non riuscita/i);
  expect(
    scritto,
    `PORTA: nel pannello Aiuto il rifiuto non dice il motivo — l'utente legge solo "${scritto}"`,
  ).not.toMatch(/ho letto/i);
  expect(
    scritto,
    'PORTA: nel pannello Aiuto il rifiuto non dice dove si cambia il livello',
  ).not.toMatch(/Preferenze/);
});
