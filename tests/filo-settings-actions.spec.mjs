// #146.5 — "Filo deve poter modificare QUALSIASI impostazione".
//
// Ogni impostazione della pagina Opzioni è esposta come azione IMPOSTA_PREFERENZA
// col proprio costo, più INVIA_FEEDBACK e CANCELLA_MEMORIA. Se partono, chiedono
// o si fermano lo decide SN_AUTONOMIA (#530, tabella del 30/09 con #1312): qui, nel
// processo reale, al livello Normale:
//   • costo 1, e stringere un freno: l'impostazione cambia SUBITO;
//   • costo 2: NON cambia finché l'utente non conferma (manca il guardiano); alla
//     conferma cambia davvero e i campi vicini restano (deepMerge);
//   • togliere un freno (cookie meno stretti, provider, limite più alto): costo 4,
//     «conferma» digitato a ogni livello;
//   • CANCELLA_MEMORIA: cancellare per sempre, costo 4: «conferma» digitato;
//   • INVIA_FEEDBACK: non parte senza conferma.
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

test('costo 2: chiede anche a compito pulito finché manca il guardiano; dopo una ricerca dice perché, e cambia con la conferma', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const before = await getSettings(page);

  const pulito = await execAction(app, setPref('ordine_host', 'prezzo'));
  expect(pulito.executed).toBe(false);
  expect(pulito.needsConfirm).toBe(2);
  expect(pulito.describe).not.toContain('Te lo chiedo perché in questo compito');

  // Dopo aver letto altro: NON applica, torna la spiegazione per il popup col perché.
  const action = setPref('ordine_host', 'latenza');
  const r = await execAction(app, action, DOPO_UNA_RICERCA);
  expect(r.executed).toBe(false);
  expect(r.needsConfirm).toBe(2);
  expect(r.describe).toContain('Te lo chiedo perché in questo compito ho fatto una ricerca sul web.');
  expect((await getSettings(page)).ordineHost || '').not.toBe('latency');

  // Con la conferma (MSG.FILO_CONFIRM_ACTION): applica davvero, e i campi vicini restano.
  const c = await page.evaluate(async (a) =>
    chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);
  expect(c.executed).toBe(true);
  const after = await getSettings(page);
  expect(after.ordineHost).toBe('latency');
  expect(after.security?.blockPopups).toBe(before.security?.blockPopups);
  expect(after.security?.fingerprint?.mode).toBe(before.security?.fingerprint?.mode);

  // Stringere una protezione è costo 1: si fa da solo, anche dopo una lettura.
  const subito = await execAction(app, setPref('fingerprint', 'privacy'), DOPO_UNA_RICERCA);
  expect(subito.executed).toBe(true);
  expect(subito.needsConfirm).toBeUndefined();
  await expect.poll(async () => (await getSettings(page)).security?.fingerprint?.mode).toBe('privacy');
  const cookie = await execAction(app, setPref('gestione_cookie', 'privacy'));
  expect(cookie.executed).toBe(true);
  await expect.poll(async () => (await getSettings(page)).security?.cookies?.mode).toBe('privacy');
  expect(Array.isArray((await getSettings(page)).security?.cookies?.trustedSites)).toBe(true);
});

test('togliere un freno vuole «conferma» anche a compito pulito: provider, cookie meno stretti', async ({ app, openTab }) => {
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

test('CANCELLA_MEMORIA: cancellare per sempre vuole «conferma», e confermata svuota la memoria', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const action = { type: 'CANCELLA_MEMORIA' };
  await app.evaluate(() =>
    globalThis.SN_FILO_MEMORY.patchMemory({ PROFILO: 'utente di prova', PREFERENZE: 'preferisce il dark' }));

  const r = await execAction(app, action);
  expect(r.executed).toBe(false);
  expect(r.needsConfirm).toBe(3);
  expect(r.no).toBeFalsy();
  expect((await app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory())).PROFILO).toBe('utente di prova');

  const c = await page.evaluate(async (a) => chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);
  expect(c.executed).toBe(true);
  const mem = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory());
  expect(mem.PROFILO).toBe('');
  expect(mem.PREFERENZE).toBe('');
});
