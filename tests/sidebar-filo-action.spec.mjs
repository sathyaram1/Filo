// L'agente "Aiuto" (la sidebar on-page) deve poter fare ciò che l'utente fa col
// menu tasto destro — a partire dall'INVIARE UN FEEDBACK agli sviluppatori — con
// lo stesso popup di conferma del resto di Filo.
//
// Feedback alpha #192: "voglio che filo dal pannello aiuto possa fare qualsiasi
// cosa possa fare l'utente con tasto destro (con popup di sicurezza coerente)".
// La conversazione allegata mostrava l'agente che dichiarava di NON poter
// inviare un feedback. Qui asseriamo che ora PUÒ, passando per lo stesso
// registro dei livelli di sicurezza della chat dashboard (INVIA_FEEDBACK è
// livello 2 → popup di conferma con anteprima, invio solo dopo l'OK).

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Esegue il PRIMO dispatch (non confermato) come fa la sidebar dell'agente,
// passando dallo stesso ponte IPC delle pagine.
const runAction = (page, action) =>
  page.evaluate(async (a) =>
    chrome.runtime.sendMessage({ type: 'filo_run_action', action: a }), action);

test('FILO_RUN_ACTION: inviare un feedback è livello 2 → conferma richiesta, niente invio finché non si conferma', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const action = { type: 'INVIA_FEEDBACK', testo: 'Lo schermo intero lascia la barra in alto', titolo: 'Schermo intero' };

  // Senza conferma: il feedback NON parte; torna livello + spiegazione (con
  // l'anteprima del testo) per il popup.
  const r = await runAction(page, action);
  expect(r.executed).toBe(false);
  expect(r.kept).toBe(true);
  expect(r.needsConfirm).toBe(2);
  expect(r.describe).toContain('schermo intero'.toLowerCase());
});

test('azione fuori registro chiesta dalla sidebar è rifiutata (nessun canale privilegiato)', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const r = await runAction(page, { type: 'FORMATTA_DISCO', target: 'C:' });
  expect(r.executed).toBe(false);
  expect(r.kept).toBe(false);
});

test('il modulo di conferma di Filo (SN_CONFIRM_UI) è disponibile nel contesto della pagina', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  expect(await page.evaluate(() => typeof window.SN_CONFIRM_UI?.confirm === 'function')).toBe(true);
  // E la sidebar espone l'hook del ponte azioni-Filo.
  expect(await page.evaluate(() => typeof window.__filoSidebarTest?.runFiloAction === 'function')).toBe(true);
});

test('dalla sidebar: il popup di conferma compare; Annulla NON invia; OK invia davvero il feedback', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);

  // Stub del submit feedback nel main: registra le chiamate e NON tocca la rete
  // (asseriamo il SUCCESSO — il feedback parte — senza scrivere su Firestore).
  await app.evaluate(() => {
    const FB = globalThis.SN_FEEDBACK;
    globalThis.__origFbSubmit = FB.submit;
    globalThis.__fbCalls = [];
    FB.submit = async (payload) => { globalThis.__fbCalls.push(payload); return { id: 'test-fb' }; };
  });

  // Apri la sidebar così la riga di log compare nella conversazione.
  await page.evaluate(() => window.SN_SIDEBAR.open());

  const action = { type: 'INVIA_FEEDBACK', testo: 'Bug nel pulsante schermo intero', titolo: 'Schermo intero' };

  // 1) Annulla → nessun invio.
  await page.evaluate((a) => { window.__filoSidebarTest.runFiloAction(a); }, action);
  const overlay = page.locator('.sn-confirm-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('feedback');
  await overlay.locator('.sn-confirm-btn-cancel').click();
  await expect(overlay).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__fbCalls.length)).toBe(0);
  await expect(page.locator('.sn-sidebar-log').last()).toContainText('annullata');

  // 2) OK → il feedback parte davvero (lo stub registra il testo).
  await page.evaluate((a) => { window.__filoSidebarTest.runFiloAction(a); }, action);
  await expect(overlay).toBeVisible();
  await overlay.locator('.sn-confirm-btn-ok').click();
  await expect(overlay).toHaveCount(0);
  await expect.poll(() => app.evaluate(() => globalThis.__fbCalls.length)).toBe(1);
  const sent = await app.evaluate(() => globalThis.__fbCalls[0]);
  expect(sent.text).toContain('schermo intero');
  expect(sent.clientId).toBe('filo:chat');
  await expect(page.locator('.sn-sidebar-log').last()).toContainText('fatto');

  // Ripristina il submit reale.
  await app.evaluate(() => { globalThis.SN_FEEDBACK.submit = globalThis.__origFbSubmit; });
});
