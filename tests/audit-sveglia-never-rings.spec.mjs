// AUDIT (prober) — riproduzione: l'azione SVEGLIA di Filo non programma nulla.
//
// Il prompt di sistema promette al modello "SVEGLIA: {orario, etichetta} —
// programma sveglia (HH:MM o ISO)" e il manifesto capacità dice che Filo può
// "impostare timer e sveglie". In realtà l'esecuzione dell'azione si limita ad
// aggiungere SUBITO una card statica "Sveglia: 07:00" nella colonna live della
// nuova scheda: nessun conto alla rovescia, nessuna suoneria all'orario chiesto.
//
// Questo spec DOCUMENTA il comportamento attuale (passa oggi): serve come
// riproduzione per il feedback d'audit, poi va rimosso o trasformato nel test
// del fix (che dovrà asserire il contrario: qualcosa di programmato che suona).

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Esegue un'azione Filo nel main process, come farebbe la chat (handleFiloChat).
const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

test('SVEGLIA: Filo dice "fatto" ma non programma nulla che suoni', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForLoadState('domcontentloaded');

  // L'utente chiede "sveglia alle 07:00 per lavoro" → il modello emette
  // {"type":"SVEGLIA","time":"07:00","label":"lavoro"} e il main la esegue.
  const r = await execAction(app, { type: 'SVEGLIA', time: '07:00', label: 'lavoro' });

  // Filo risponde che l'azione è andata a buon fine (l'utente si fida).
  expect(r.executed).toBe(true);

  // 1) NESSUN timer/conto alla rovescia è stato programmato: allo scattare
  //    delle 07:00 non c'è alcun meccanismo che possa suonare.
  const timers = await page.evaluate(async () =>
    (await chrome.runtime.sendMessage({ type: 'filo_get_timers' })).timers);
  expect(timers.length).toBe(0);

  // 2) L'unico effetto è una notifica STATICA aggiunta immediatamente (non
  //    alle 07:00): testo fisso, nessun campo con l'orario programmato.
  const notifications = await page.evaluate(async () =>
    (await chrome.runtime.sendMessage({ type: 'filo_get_notifications' })).notifications);
  const sveglia = notifications.find((n) => /Sveglia: 07:00/.test(n.text || ''));
  expect(sveglia).toBeTruthy();
  expect(sveglia.kind).toBe('process');
  // Nessuna traccia di scheduling nell'entry (solo il timestamp di creazione).
  expect(sveglia.endsAt).toBeUndefined();
  expect(sveglia.when).toBeUndefined();

  // La card compare subito nella colonna live della nuova scheda.
  const card = page.locator('.dash-live-card', { hasText: 'Sveglia: 07:00' });
  await expect(card).toBeVisible({ timeout: 10_000 });

  await page.screenshot({ path: 'tests/.shots/audit-sveglia-static.png' });
});
