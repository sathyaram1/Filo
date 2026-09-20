// #146.5 — "Filo deve poter modificare QUALSIASI impostazione".
//
// Ogni impostazione della pagina Opzioni è esposta come azione
// IMPOSTA_PREFERENZA col proprio COSTO (#530), più INVIA_FEEDBACK e
// CANCELLA_MEMORIA. Qui esercitiamo, nel processo reale dell'app, un caso per
// tipo di risposta:
//   • costo 1: l'impostazione cambia SUBITO (verificato leggendo lo storage);
//   • costo 2 che STRINGE (cookie su privacy, provider): a livello normale e
//     compito pulito si applica da sé, e i campi vicini restano intatti;
//   • costo 2 che ALLENTA (cookie su automatico, terminale acceso): vuole la
//     parola digitata a ogni livello — regola (d);
//   • compito CONTAMINATO: la stessa impostazione che si applicava da sé torna
//     a chiedere;
//   • INVIA_FEEDBACK (costo 3): non parte senza conferma;
//   • CANCELLA_MEMORIA: Filo non la fa più, a nessun livello, e dice dove si fa.
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

test('costo 2 che stringe: si applica da sé, e i campi vicini restano intatti', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const before = await getSettings(page);
  expect(before.security?.cookies?.mode).toBe('default');

  // Compito pulito, livello normale: portare i cookie su «privacy» stringe una
  // protezione, e stringere è sempre libero. Prima chiedeva un popup (#530).
  const r = await execAction(app, setPref('gestione_cookie', 'privacy'));
  expect(r.executed).toBe(true);
  expect(r.needsConfirm).toBeUndefined();
  const after = await getSettings(page);
  expect(after.security?.cookies?.mode).toBe('privacy');
  // deepMerge: i campi vicini in security NON sono stati azzerati.
  expect(after.security?.blockPopups).toBe(before.security?.blockPopups);
  expect(after.security?.fingerprint?.mode).toBe(before.security?.fingerprint?.mode);
  expect(Array.isArray(after.security?.cookies?.trustedSites)).toBe(true);
});

test('costo 2 che ALLENTA: vuole la parola digitata, e senza non cambia niente', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  // Tornare da «privacy» ad «automatico» toglie una protezione: regola (d),
  // parola digitata a ogni livello, anche col compito pulito.
  const action = setPref('gestione_cookie', 'automatico');
  const r = await execAction(app, action);
  expect(r.executed).toBe(false);
  expect(r.needsConfirm).toBe(3);
  expect(r.describe).toMatch(/cookie/i);
  expect(r.describe).toMatch(/allenta una protezione|scriverlo/i);

  // Con la conferma dell'utente applica davvero.
  const c = await page.evaluate(async (a) =>
    chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);
  expect(c.executed).toBe(true);
  expect((await getSettings(page)).security?.cookies?.mode).toBe('default');
});

test('il compito contaminato fa tornare la richiesta: stessa impostazione, altra risposta', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  // Stesso cambio di prima (stringe, costo 2), ma l'azione arriva da dentro una
  // pagina web: quel testo l'ha scritto qualcun altro e ora Filo chiede.
  const pagina = { tab: { id: 8101, url: 'http://esempio.test/x' }, url: 'http://esempio.test/x' };
  const r = await execAction(app, setPref('gestione_cookie', 'privacy'), { sender: pagina });
  expect(r.executed).toBe(false);
  expect(r.needsConfirm).toBe(2);
  expect(String(r.describe)).toMatch(/pagina web/i);
  expect((await getSettings(page)).security?.cookies?.mode).toBe('default');
});

test('INVIA_FEEDBACK è gated: senza conferma non invia nulla, e il popup mostra il testo', async ({ app, openTab }) => {
  await openTab(NEWTAB);
  const action = { type: 'INVIA_FEEDBACK', testo: 'La ricerca nella sidebar è troppo lenta', titolo: 'ricerca lenta' };
  const r = await execAction(app, action);
  expect(r.executed).toBe(false);
  expect(r.needsConfirm).toBe(2);
  expect(r.describe).toMatch(/feedback/i);
  expect(r.describe).toContain('La ricerca nella sidebar è troppo lenta');
});

test('un\'impostazione che tocca la spesa si applica da sé in un compito pulito', async ({ app, openTab }) => {
  // #530 — costo 2: dura, ma si disfa dalle Opzioni. Prima chiedeva un popup;
  // ora, se in quella conversazione è entrato solo quello che ha scritto
  // l'utente, Filo lo fa e basta. Dopo una pagina web tornerebbe a chiedere
  // (è il caso qui sopra).
  const page = await openTab(NEWTAB);
  const r = await execAction(app, setPref('limite_spesa', '99'));
  expect(r.executed).toBe(true);
  await expect.poll(async () => (await getSettings(page)).monthlyLimitEur).toBe(99);
});

test('CANCELLA_MEMORIA: Filo non la fa più, e dice dove si fa a mano', async ({ app, openTab }) => {
  await openTab(NEWTAB);
  const action = { type: 'CANCELLA_MEMORIA' };

  // Prima: scrivi qualcosa in memoria così avremmo qualcosa da perdere.
  await app.evaluate(() =>
    globalThis.SN_FILO_MEMORY.patchMemory({ PROFILO: 'utente di prova', PREFERENZE: 'preferisce il dark' }));

  // #530 — cancellare dati in modo definitivo è nell'elenco fisso: no a ogni
  // livello, e nemmeno arrivando già «confermata». Il rifiuto porta con sé la
  // strada vera, che è il pulsante in Preferenze (tests/autonomia-livelli).
  for (const opts of [undefined, { confirmed: true }]) {
    const r = await execAction(app, action, opts);
    expect(r.executed).toBe(false);
    expect(r.rejected).toBe(true);
    expect(String(r.error)).toMatch(/Preferenze/i);
  }

  const mem = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory());
  expect(mem.PROFILO).toBeTruthy();
  expect(mem.PREFERENZE).toBeTruthy();
});
