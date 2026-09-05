// #146.5 — "Filo deve poter modificare QUALSIASI impostazione".
//
// Ogni impostazione della pagina Opzioni è esposta come azione IMPOSTA_PREFERENZA
// col proprio livello di sicurezza, più l'azione INVIA_FEEDBACK (livello 2) e
// l'azione CANCELLA_MEMORIA (livello 3). Qui esercitiamo, nel processo reale
// dell'app, un caso PER LIVELLO end-to-end:
//   • livello 1: l'impostazione cambia SUBITO (verificato leggendo lo storage);
//   • livello 2: NON cambia finché l'utente non conferma; alla conferma cambia
//     davvero e i campi vicini restano intatti (deepMerge);
//   • livello 3 (CANCELLA_MEMORIA): non parte senza conferma; dopo confirmed:true
//     la memoria è davvero azzerata (verificata leggendo lo storage);
//   • INVIA_FEEDBACK: è gated a livello 2 (non parte senza conferma).
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

test('livello 1: un\'impostazione semplice cambia subito, senza conferma', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  // Il correttore parte attivo (default). Filo lo disattiva → livello 1.
  expect((await getSettings(page)).featureFlags?.spellcheck).toBe(true);

  const r = await execAction(app, setPref('correttore', 'off'));
  expect(r.executed).toBe(true);
  expect(r.needsConfirm).toBeUndefined();
  await expect.poll(async () => (await getSettings(page)).featureFlags?.spellcheck).toBe(false);
});

test('livello 2: impostazione di sicurezza — non cambia senza conferma, cambia con la conferma', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const before = await getSettings(page);
  expect(before.security?.cookies?.mode).toBe('default');

  // Senza conferma: NON applica, torna livello + spiegazione per il popup.
  const action = setPref('gestione_cookie', 'privacy');
  const r = await execAction(app, action);
  expect(r.executed).toBe(false);
  expect(r.needsConfirm).toBe(2);
  expect(r.describe).toMatch(/cookie/i);
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
});

test('livello 2: cambio provider — confermato, persiste sullo storage', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const action = setPref('provider', 'openrouter');

  const r = await execAction(app, action);
  expect(r.needsConfirm).toBe(2);
  const c = await page.evaluate(async (a) =>
    chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);
  expect(c.executed).toBe(true);
  expect((await getSettings(page)).provider).toBe('openrouter');
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

test('le impostazioni sensibili NON sono auto-applicate da un giro di chat (restano in attesa di conferma)', async ({ app, openTab }) => {
  // Simula ciò che fa handleFiloChat: esegue l'azione senza `confirmed`. Una
  // preferenza di livello 2 deve tornare `kept` con needsConfirm, MAI eseguita.
  const page = await openTab(NEWTAB);
  const r = await execAction(app, setPref('limite_spesa', '99'));
  expect(r.executed).toBe(false);
  expect(r.kept).toBe(true);
  expect(r.needsConfirm).toBe(2);
  // Il limite di default resta invariato.
  expect((await getSettings(page)).monthlyLimitEur).not.toBe(99);
});

test('livello 3: CANCELLA_MEMORIA — non parte senza conferma; dopo confirmed:true la memoria è azzerata', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const action = { type: 'CANCELLA_MEMORIA' };

  // Prima: scrivi qualcosa in memoria così abbiamo qualcosa da cancellare.
  await app.evaluate(() =>
    globalThis.SN_FILO_MEMORY.patchMemory({ PROFILO: 'utente di prova', PREFERENZE: 'preferisce il dark' }));
  const memBefore = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory());
  expect(memBefore.PROFILO).toBeTruthy();

  // Senza conferma: NON esegue, richiede livello 3.
  const r = await execAction(app, action);
  expect(r.executed).toBe(false);
  expect(r.needsConfirm).toBe(3);
  expect(r.describe).toMatch(/memoria/i);
  // La memoria è ancora intatta.
  const memStill = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory());
  expect(memStill.PROFILO).toBeTruthy();

  // Con confirmed:true (l'utente ha digitato "conferma"): la memoria sparisce davvero.
  const c = await execAction(app, action, { confirmed: true });
  expect(c.executed).toBe(true);
  const memAfter = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory());
  expect(memAfter.PROFILO || '').toBe('');
  expect(memAfter.PREFERENZE || '').toBe('');
});
