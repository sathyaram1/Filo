// #322 — L'azione SVEGLIA programma una sveglia REALE che suona all'orario.
//
// Prima l'esecuzione si limitava ad aggiungere una card statica "Sveglia:
// 07:00" (una notifica) senza alcuno scheduling: alle 07:00 non succedeva
// nulla. Ora la sveglia entra nella lista dei timer con scadenza ASSOLUTA
// (kind 'alarm') e riusa il flusso ringing/suoneria dei timer; in più un
// watcher nel main mostra una notifica di sistema alla scadenza.
//
// Questo spec asserisce il SUCCESSO: la sveglia è schedulata (endsAt =
// l'orario chiesto), la card mostra l'orario, e allo scattare dell'orario la
// colonna live passa in stato ringing con il bottone "Ferma" che la spegne.
// Senza il fix, il primo assert sul timer schedulato diventa rosso.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Esegue un'azione Filo nel main process, come farebbe la chat (handleFiloChat).
const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

test('SVEGLIA programma una scadenza reale e suona all\'orario', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForLoadState('domcontentloaded');

  // Sveglia tra ~6 secondi (ISO assoluto), così il test la vede suonare.
  const target = new Date(Date.now() + 6000);
  const r = await execAction(app, { type: 'SVEGLIA', time: target.toISOString(), label: 'lavoro' });
  expect(r.executed).toBe(true);

  // 1) La sveglia è SCHEDULATA: entry nella lista timer con kind 'alarm' e
  //    scadenza = l'orario chiesto (non una notifica statica).
  const timers = await page.evaluate(async () =>
    (await chrome.runtime.sendMessage({ type: 'filo_get_timers' })).timers);
  const alarm = timers.find((t) => t.kind === 'alarm');
  expect(alarm).toBeTruthy();
  expect(alarm.label).toBe('lavoro');
  expect(Math.abs(new Date(alarm.endsAt).getTime() - target.getTime())).toBeLessThan(1500);

  // 2) Niente più card-etichetta immediata: nessuna notifica statica "Sveglia:".
  const notifications = await page.evaluate(async () =>
    (await chrome.runtime.sendMessage({ type: 'filo_get_notifications' })).notifications);
  expect(notifications.find((n) => /Sveglia:/.test(n.text || ''))).toBeFalsy();

  // 3) La card della sveglia è visibile con l'orario programmato.
  const card = page.locator('.dash-live-card', { hasText: 'Sveglia' });
  await expect(card).toBeVisible({ timeout: 10_000 });

  // 4) Allo scattare dell'orario la sveglia SUONA: la colonna live passa in
  //    stato ringing (proxy osservabile della suoneria, che in headless non
  //    si sente) e compare il bottone "Ferma".
  await expect(page.locator('#live')).toHaveAttribute('data-ringing', '1', { timeout: 20_000 });
  const stop = page.locator('.dash-live-stop');
  await expect(stop).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/sveglia-ringing.png' });

  // 5) "Ferma" spegne la sveglia: niente più ringing, lista timer vuota.
  await stop.click();
  await expect(page.locator('#live')).toHaveAttribute('data-ringing', '0', { timeout: 5_000 });
  const after = await page.evaluate(async () =>
    (await chrome.runtime.sendMessage({ type: 'filo_get_timers' })).timers);
  expect(after.length).toBe(0);
});

test('SVEGLIA "HH:MM" già passato oggi → programmata per domani', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForLoadState('domcontentloaded');

  // Un orario di un minuto fa, in formato HH:MM → prossima occorrenza = domani.
  const past = new Date(Date.now() - 60_000);
  const hhmm = `${String(past.getHours()).padStart(2, '0')}:${String(past.getMinutes()).padStart(2, '0')}`;
  const r = await execAction(app, { type: 'SVEGLIA', time: hhmm, label: 'domattina' });
  expect(r.executed).toBe(true);

  const timers = await page.evaluate(async () =>
    (await chrome.runtime.sendMessage({ type: 'filo_get_timers' })).timers);
  const alarm = timers.find((t) => t.kind === 'alarm');
  expect(alarm).toBeTruthy();
  const delta = new Date(alarm.endsAt).getTime() - Date.now();
  // Nel futuro, entro 24 ore (domani alla stessa ora, ~1 min in meno).
  expect(delta).toBeGreaterThan(0);
  expect(delta).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
});

test('SVEGLIA con orario non interpretabile → non eseguita, niente card', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForLoadState('domcontentloaded');

  const r = await execAction(app, { type: 'SVEGLIA', time: 'boh', label: 'x' });
  expect(r.executed).toBe(false);

  const timers = await page.evaluate(async () =>
    (await chrome.runtime.sendMessage({ type: 'filo_get_timers' })).timers);
  expect(timers.length).toBe(0);
});
