// #146.5 — "Filo deve poter modificare QUALSIASI impostazione".
//
// Ogni impostazione della pagina Opzioni è esposta come azione IMPOSTA_PREFERENZA
// col proprio costo, più INVIA_FEEDBACK e CANCELLA_MEMORIA. Se partono, chiedono
// o si fermano lo decide SN_AUTONOMIA (#530): qui, nel processo reale, al livello
// Normale:
//   • costo 1 e costo 2 a compito pulito: l'impostazione cambia SUBITO;
//   • costo 2 dopo aver letto cose scritte da altri: NON cambia finché l'utente non
//     conferma; alla conferma cambia davvero e i campi vicini restano (deepMerge);
//   • spegnere una difesa (cookie meno stretti, provider, limite più alto): vuole
//     «conferma» digitato anche a compito pulito;
//   • CANCELLA_MEMORIA: Filo non la fa da solo, nemmeno confermata;
//   • INVIA_FEEDBACK che l'utente non ha chiesto: non parte senza conferma.
// Gli assert verificano il SUCCESSO (lo stato diventa quello richiesto), non
// l'assenza di un errore.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

const getSettings = (page) =>
  page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'get_settings' })).settings);

const setPref = (chiave, valore, extra = {}) => ({ type: 'IMPOSTA_PREFERENZA', chiave, valore, ...extra });
// Un compito che ha letto una ricerca sul web: testo scritto da altri nel contesto.
const DOPO_UNA_RICERCA = { contesto: [{ type: 'CERCA_WEB', query: 'x', _output: { results: [{ url: 'https://esempio.test/' }] } }] };

test('livello 1: un\'impostazione semplice cambia subito, senza conferma', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  // Il correttore parte attivo (default). Filo lo disattiva → livello 1.
  expect((await getSettings(page)).featureFlags?.spellcheck).toBe(true);

  const r = await execAction(app, setPref('correttore', 'off'));
  expect(r.executed).toBe(true);
  expect(r.needsConfirm).toBeUndefined();
  await expect.poll(async () => (await getSettings(page)).featureFlags?.spellcheck).toBe(false);
});

test('costo 2: a compito pulito si applica subito; dopo una ricerca chiede, e cambia con la conferma', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const before = await getSettings(page);
  expect(before.security?.cookies?.mode).toBe('default');

  // Dopo aver letto altro: NON applica, torna la spiegazione per il popup.
  const action = setPref('gestione_cookie', 'privacy');
  const r = await execAction(app, action, DOPO_UNA_RICERCA);
  expect(r.executed).toBe(false);
  expect(r.needsConfirm).toBe(2);
  expect(r.describe).toMatch(/cookie/i);
  expect(r.describe).toContain('Te lo chiedo perché in questo compito ho fatto una ricerca sul web.');
  expect((await getSettings(page)).security?.cookies?.mode).toBe('default');

  // Con la conferma (MSG.FILO_CONFIRM_ACTION): applica davvero.
  const c = await page.evaluate(async (a) =>
    chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);
  expect(c.executed).toBe(true);
  const after = await getSettings(page);
  expect(after.security?.cookies?.mode).toBe('privacy');
  // deepMerge: i campi vicini in security NON sono stati azzerati.
  expect(after.security?.blockPopups).toBe(before.security?.blockPopups);
  expect(after.security?.fingerprint?.mode).toBe(before.security?.fingerprint?.mode);
  expect(Array.isArray(after.security?.cookies?.trustedSites)).toBe(true);

  // A compito pulito, stringere una protezione si fa da solo.
  const subito = await execAction(app, setPref('fingerprint', 'privacy'));
  expect(subito.executed).toBe(true);
  expect(subito.needsConfirm).toBeUndefined();
  await expect.poll(async () => (await getSettings(page)).security?.fingerprint?.mode).toBe('privacy');
});

test('spegnere una difesa vuole «conferma» anche a compito pulito: provider, cookie meno stretti', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const action = setPref('provider', 'openrouter');
  const r = await execAction(app, action);
  expect(r.needsConfirm).toBe(3);
  expect(r.avviso).toBe('Abbassa una difesa di Filo.');
  const c = await page.evaluate(async (a) =>
    chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);
  expect(c.executed).toBe(true);
  expect((await getSettings(page)).provider).toBe('openrouter');

  const cookie = await execAction(app, setPref('gestione_cookie', 'manuale'));
  expect(cookie.executed).toBe(false);
  expect(cookie.needsConfirm).toBe(3);
  expect((await getSettings(page)).security?.cookies?.mode).toBe('default');
});

test('INVIA_FEEDBACK è gated a livello 2: senza conferma non invia nulla', async ({ app, openTab }) => {
  await openTab(NEWTAB);
  const action = { type: 'INVIA_FEEDBACK', testo: 'La ricerca nella sidebar è troppo lenta', titolo: 'ricerca lenta' };
  const r = await execAction(app, action);
  expect(r.executed).toBe(false);
  expect(r.needsConfirm).toBe(2);
  expect(r.describe).toMatch(/feedback/i);
  expect(r.describe).toContain('La ricerca nella sidebar è troppo lenta');
});

test('le impostazioni che abbassano una difesa NON sono auto-applicate da un giro di chat', async ({ app, openTab }) => {
  // Simula ciò che fa handleFiloChat: esegue l'azione senza `confirmed`. Alzare il
  // limite di spesa deve tornare `kept` con la «conferma» da digitare, MAI eseguita.
  const page = await openTab(NEWTAB);
  const r = await execAction(app, setPref('limite_spesa', '99'));
  expect(r.executed).toBe(false);
  expect(r.kept).toBe(true);
  expect(r.needsConfirm).toBe(3);
  // Il limite di default resta invariato.
  expect((await getSettings(page)).monthlyLimitEur).not.toBe(99);
});

test('CANCELLA_MEMORIA: Filo non svuota la memoria da solo, nemmeno confermata, e dice dove farlo', async ({ app, openTab }) => {
  await openTab(NEWTAB);
  const action = { type: 'CANCELLA_MEMORIA' };
  await app.evaluate(() =>
    globalThis.SN_FILO_MEMORY.patchMemory({ PROFILO: 'utente di prova', PREFERENZE: 'preferisce il dark' }));

  for (const opts of [{}, { confirmed: true }]) {
    const r = await execAction(app, action, opts);
    expect(r.executed).toBe(false);
    expect(r.needsConfirm).toBeUndefined();
    expect(r.no).toBe(true);
    expect(r.error).toContain('Memoria di Filo');
  }
  const mem = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory());
  expect(mem.PROFILO).toBe('utente di prova');
  expect(mem.PREFERENZE).toBe('preferisce il dark');
});
