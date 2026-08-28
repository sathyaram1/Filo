// Dalla chat si potevano solo CREARE sveglie e timer: niente azione per
// toglierli o spostarli (i modelli o dichiaravano di averlo fatto o si
// arrendevano), e ogni sveglia era a occorrenza singola — chi ha lezione "il
// lunedì e il mercoledì" non poteva averla.
//
// Questo spec esercita il giro vero, senza LLM: l'azione la si esegue nel main
// come farebbe la chat, e si guarda cosa vede l'utente nella colonna destra
// della nuova scheda.
//
//   1. una sveglia RICORRENTE si crea e si vede, con i giorni scritti;
//   2. la si CANCELLA chiedendolo per etichetta → sparisce dalla colonna;
//   3. una sveglia si SPOSTA a un altro orario → la colonna mostra il nuovo;
//   4. "togli tutte le sveglie" chiede conferma ed elenca cosa sta per sparire,
//      e finché non arriva la conferma non tocca niente (è il caso da cui è
//      nato tutto: fra le sveglie ce n'era una per l'antibiotico);
//   5. i timer restano in piedi quando si cancellano "tutte le sveglie".
//
// Senza le nuove azioni i passi 2-5 sono rossi (azione non registrata → il
// dispatch la rifiuta) e al passo 1 la card non nomina i giorni.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

const readTimers = (page) =>
  page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'filo_get_timers' })).timers);

test('sveglia ricorrente: si vede con i suoi giorni e si cancella chiedendolo', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForLoadState('domcontentloaded');

  // 1) Creata come la creerebbe la chat: "sveglia alle 7:55 il lunedì e il
  //    mercoledì per la lezione".
  const r = await execAction(app, {
    type: 'SVEGLIA', time: '07:55', label: 'lezione', ripeti: ['lun', 'mer'],
  });
  expect(r.executed).toBe(true);

  const timers = await readTimers(page);
  const alarm = timers.find((t) => t.kind === 'alarm');
  expect(alarm).toBeTruthy();
  expect(alarm.repeat).toEqual(['lun', 'mer']);
  // La prossima occorrenza cade davvero di lunedì o di mercoledì, alle 07:55.
  const when = new Date(alarm.endsAt);
  expect([1, 3]).toContain(when.getDay());
  expect(when.getHours()).toBe(7);
  expect(when.getMinutes()).toBe(55);

  // La colonna destra lo dice: orario + giorni, non "07:55 di domani".
  const card = page.locator('.dash-live-card', { hasText: 'lezione' });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText('07:55');
  await expect(card).toContainText('lun+mer');

  // 2) "cancella la sveglia della lezione" → sparisce davvero.
  const del = await execAction(app, { type: 'CANCELLA_SVEGLIA', etichetta: 'lezione' });
  expect(del.executed).toBe(true);
  expect(del.output.removed.join(' ')).toContain('lezione');
  await expect(page.locator('.dash-live-card', { hasText: 'lezione' })).toHaveCount(0, { timeout: 10_000 });
  expect((await readTimers(page)).length).toBe(0);
});

test('spostare una sveglia a un altro orario', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForLoadState('domcontentloaded');

  await execAction(app, { type: 'SVEGLIA', time: '06:30', label: 'palestra', ripeti: 'feriali' });
  const card = page.locator('.dash-live-card', { hasText: 'palestra' });
  await expect(card).toContainText('06:30', { timeout: 10_000 });
  await expect(card).toContainText('feriali');

  const mod = await execAction(app, { type: 'MODIFICA_SVEGLIA', etichetta: 'palestra', orario: '08:15' });
  expect(mod.executed).toBe(true);

  // L'utente vede il nuovo orario, e la ricorrenza non si è persa per strada.
  await expect(page.locator('.dash-live-card', { hasText: 'palestra' }))
    .toContainText('08:15', { timeout: 10_000 });
  await expect(page.locator('.dash-live-card', { hasText: 'palestra' })).toContainText('feriali');

  const alarm = (await readTimers(page)).find((t) => t.kind === 'alarm');
  expect(alarm.atTime).toBe('08:15');
  expect(alarm.repeat).toEqual(['lun', 'mar', 'mer', 'gio', 'ven']);
});

test('"togli tutte le sveglie" elenca cosa sparisce e aspetta l\'OK; i timer restano', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForLoadState('domcontentloaded');

  await execAction(app, { type: 'SVEGLIA', time: '07:00', label: 'palestra', ripeti: 'feriali' });
  await execAction(app, { type: 'SVEGLIA', time: '20:00', label: 'antibiotico', ripeti: 'ogni giorno' });
  await execAction(app, { type: 'TIMER', seconds: 900, label: 'pasta' });
  expect((await readTimers(page)).length).toBe(3);

  // Cancellarne più d'una NON parte da sola: chiede conferma, e nella
  // spiegazione c'è scritto cosa sta per perdere (l'antibiotico compreso).
  const ask = await execAction(app, { type: 'CANCELLA_SVEGLIA', tutte: true, tipo: 'sveglia' });
  expect(ask.executed).toBe(false);
  expect(ask.needsConfirm).toBe(2);
  expect(ask.describe).toContain('palestra');
  expect(ask.describe).toContain('antibiotico');

  // Finché l'utente non conferma, in colonna c'è ancora tutto.
  await expect(page.locator('.dash-live-card', { hasText: 'antibiotico' })).toBeVisible({ timeout: 10_000 });
  expect((await readTimers(page)).length).toBe(3);

  // Dopo l'OK spariscono le sveglie — e SOLO quelle: il timer della pasta resta.
  const done = await execAction(app, { type: 'CANCELLA_SVEGLIA', tutte: true, tipo: 'sveglia' }, { confirmed: true });
  expect(done.executed).toBe(true);
  await expect(page.locator('.dash-live-card', { hasText: 'antibiotico' })).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('.dash-live-card', { hasText: 'pasta' })).toBeVisible();

  const left = await readTimers(page);
  expect(left.length).toBe(1);
  expect(left[0].label).toBe('pasta');
});

test('una sveglia che non esiste non fa sparire quella che c\'è', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await page.waitForLoadState('domcontentloaded');

  await execAction(app, { type: 'SVEGLIA', time: '07:00', label: 'palestra' });
  const r = await execAction(app, { type: 'CANCELLA_SVEGLIA', etichetta: 'dentista' });
  expect(r.executed).toBe(false);
  await expect(page.locator('.dash-live-card', { hasText: 'palestra' })).toBeVisible({ timeout: 10_000 });
  expect((await readTimers(page)).length).toBe(1);
});

test('una sveglia ricorrente suona e resta: "Ferma" non la disdice', async ({ app, openTab }) => {
  // Qui si aspetta una sveglia che suona per davvero e poi la suoneria che si
  // spegne: sotto il carico della suite intera i 60s di default finiscono nello
  // spegnimento dell'app, non nel test.
  test.slow();
  const page = await openTab(NEWTAB);
  await page.waitForLoadState('domcontentloaded');

  await execAction(app, { type: 'SVEGLIA', time: '07:00', label: 'pillola', ripeti: 'ogni giorno' });

  // Portiamo la scadenza a fra pochi secondi senza aspettare le 07:00: è la
  // stessa cosa che farà l'orologio, e la ricorrenza resta quella vera.
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    const KEY = globalThis.SN_CONST.STORAGE_KEYS.FILO_TIMERS;
    const list = await M.listTimers();
    list[0].endsAt = new Date(Date.now() + 4000).toISOString();
    await chrome.storage.local.set({ [KEY]: list });
  });

  // Suona.
  await expect(page.locator('#live')).toHaveAttribute('data-ringing', '1', { timeout: 20_000 });
  const card = page.locator('.dash-live-card', { hasText: 'pillola' });
  await expect(card).toContainText('ogni giorno');

  // "Ferma" la zittisce, ma domani suona ancora: resta in colonna con la sua
  // ricorrenza e con la prossima occorrenza nel futuro. Prima una sveglia
  // fermata spariva, e questo è il passo che senza la ricorrenza è rosso.
  // La colonna si ridisegna ogni secondo (i timer scorrono): senza `force` il
  // click aspetta una stabilità che non arriva mai.
  await page.locator('.dash-live-stop').click({ force: true });
  await expect(page.locator('#live')).toHaveAttribute('data-ringing', '0', { timeout: 10_000 });
  await expect(page.locator('.dash-live-card', { hasText: 'pillola' })).toContainText('ogni giorno');

  const left = await readTimers(page);
  expect(left.length).toBe(1);
  expect(left[0].ringing).toBeFalsy();
  expect(new Date(left[0].endsAt).getTime()).toBeGreaterThan(Date.now());

  // La × invece la toglie davvero, anche se si ripete.
  await page.locator('.dash-live-card', { hasText: 'pillola' }).locator('.dash-live-dismiss').click({ force: true });
  await expect(page.locator('.dash-live-card', { hasText: 'pillola' })).toHaveCount(0, { timeout: 10_000 });
});
