// #376 — "il video è partito in una tab che ha preso priorità": quando Filo
// mette una canzone non deve strappare l'utente da dove si trova. La scheda che
// apre per farla suonare nasce in SECONDO PIANO, e il riferimento che resta
// nella conversazione ci PORTA (non ne apre un doppione).
//
// Contratto (asserisce il SUCCESSO della feature, non l'assenza di errori):
//   • NAVIGA con background → la scheda si apre DAVVERO e la scheda attiva NON
//     cambia (l'utente resta dov'era);
//   • NAVIGA senza background → continua ad attivare la nuova scheda (il flag
//     deve fare davvero la differenza: è il ramo che senza il fix era l'unico);
//   • il riferimento in chat di un'apertura in secondo piano porta a QUELLA
//     scheda (nessun doppione aperto).
//
// Pre-condizione che senza il fix fallirebbe: prima NAVIGA apriva sempre con
// activate:true → l'assert "la scheda attiva non è cambiata" era rosso.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

const execAction = (app, action) =>
  app.evaluate((_electron, { action }) => globalThis.SN_EXECUTE_FILO_ACTION(action), { action });

// Stato del TabManager: id della scheda attiva, suo URL, numero di schede e
// quante puntano a un certo URL (per scoprire i doppioni).
const tabsState = (app, url) =>
  app.evaluate(({ BrowserWindow }, { url }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoTabs.incognito);
    if (!win) return null;
    const tm = win._filoTabs;
    const active = tm.tabs.find((t) => t.id === tm.activeId) || null;
    return {
      activeId: tm.activeId,
      activeUrl: active ? active.url : '',
      count: tm.tabs.length,
      matching: tm.tabs.filter((t) => t.url === url).map((t) => t.id),
    };
  }, { url });

test('#376 — NAVIGA in secondo piano apre la scheda SENZA rubare il primo piano', async ({ app, testServer, openTab }) => {
  await openTab(NEWTAB);
  const url = testServer.html('<!doctype html><title>Canzone</title><h1>suona</h1>');

  const before = await tabsState(app, url);
  expect(before.matching).toHaveLength(0);

  const r = await execAction(app, { type: 'NAVIGA', url, label: 'Canzone', background: true });
  expect(r.executed).toBe(true);
  expect(r.background).toBe(true);
  // Il client riceve l'id della scheda nata dietro: serve al riferimento in chat.
  expect(r.output && r.output.background).toBe(true);
  expect(typeof (r.output && r.output.tabId)).toBe('string');

  // SUCCESSO 1: la scheda esiste davvero (la canzone è partita lì dentro).
  await expect.poll(async () => (await tabsState(app, url)).matching.length, { timeout: 8_000 }).toBe(1);

  // SUCCESSO 2 (il cuore del feedback): l'utente è rimasto dov'era.
  const after = await tabsState(app, url);
  expect(after.activeId).toBe(before.activeId);
  expect(after.matching).not.toContain(after.activeId);
  expect(after.count).toBe(before.count + 1);
});

test('#376 — senza il flag, NAVIGA continua a portare l’utente sulla pagina aperta', async ({ app, testServer, openTab }) => {
  await openTab(NEWTAB);
  const url = testServer.html('<!doctype html><title>Da leggere</title><h1>eccomi</h1>');

  const before = await tabsState(app, url);
  const r = await execAction(app, { type: 'NAVIGA', url, label: 'Da leggere' });
  expect(r.executed).toBe(true);
  expect(r.background).toBe(false);

  // La scheda nuova diventa quella attiva: chi chiede di APRIRE vuole arrivarci.
  await expect.poll(async () => (await tabsState(app, url)).activeUrl, { timeout: 8_000 }).toBe(url);
  const after = await tabsState(app, url);
  expect(after.activeId).not.toBe(before.activeId);
});

test('#376 — il riferimento in chat PORTA alla scheda aperta in secondo piano (niente doppione)', async ({ app, testServer, openTab }) => {
  const page = await openTab(NEWTAB);
  const url = testServer.html('<!doctype html><title>Radio</title><h1>radio</h1>');

  const r = await execAction(app, { type: 'NAVIGA', url, label: 'Radio', background: true });
  const tabId = r.output.tabId;
  await expect.poll(async () => (await tabsState(app, url)).matching.length, { timeout: 8_000 }).toBe(1);

  // Il chip che Filo lascia nella bolla, con l'esito dell'apertura in secondo piano.
  await page.evaluate(({ url, tabId }) => {
    const host = document.createElement('div');
    host.id = 'test-bg-chip';
    document.body.appendChild(host);
    window.__filoDashActions.renderActions(host, [{
      type: 'NAVIGA', url, label: 'Radio',
      _output: { background: true, tabId },
    }]);
  }, { url, tabId });

  const chip = page.locator('#test-bg-chip .dash-action-link-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Radio');

  const before = await tabsState(app, url);
  expect(before.activeId).not.toBe(tabId);

  await chip.click();

  // SUCCESSO: siamo ATTERRATI sulla scheda che già suonava, e non ne è nata
  // una seconda sullo stesso indirizzo.
  await expect.poll(async () => (await tabsState(app, url)).activeId, { timeout: 6_000 }).toBe(tabId);
  expect((await tabsState(app, url)).matching).toHaveLength(1);
});

test('#376 — i passi intermedi di Filo non sono bottoni (una sola cosa cliccabile)', async ({ openTab }) => {
  const page = await openTab(NEWTAB);

  // La stessa scena del feedback: Filo cerca sul web e poi apre il risultato.
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'test-steps';
    document.body.appendChild(host);
    window.__filoDashActions.renderActions(host, [
      { type: 'CERCA_WEB', query: 'Il conformista Gaber audio video YouTube' },
      { type: 'NAVIGA', url: 'https://www.youtube.com/watch?v=x', label: 'Il conformista - Giorgio Gaber' },
    ]);
  });

  // La traccia del passo intermedio resta LEGGIBILE (trasparenza, #368)…
  const trace = page.locator('#test-steps .dash-action-step');
  await expect(trace).toHaveCount(1);
  await expect(trace).toContainText('Cerco sul web');
  // …ma non ha più la forma di un bottone/pill.
  await expect(page.locator('#test-steps .dash-action-step.dash-action-btn')).toHaveCount(0);

  // SUCCESSO: nella bolla c'è UNA sola cosa cliccabile — il risultato vero.
  await expect(page.locator('#test-steps .dash-action-btn')).toHaveCount(1);
  await expect(page.locator('#test-steps .dash-action-btn')).toContainText('Giorgio Gaber');
});
