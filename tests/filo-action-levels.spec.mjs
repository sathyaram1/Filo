// #146.2 — Framework dei livelli di sicurezza per le azioni di Filo.
//
// Verifica il contratto della spec: livello 1 esegue subito; livello 2 NON
// esegue finché l'utente non conferma dal popup; livello 3 richiede di
// digitare "conferma"; le azioni NON registrate vengono rifiutate dal
// dispatch (anche se arrivano già "confermate" dal client).

import { test, expect } from './fixtures/electron.mjs';

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
  const overlay = page.locator('.sn-confirm-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Modalità terminale');
  await overlay.locator('.sn-confirm-btn-cancel').click();
  await expect(overlay).toHaveCount(0);
  expect((await getSettings(page)).terminal?.enabled || false).toBe(false);

  // OK → la preferenza cambia davvero.
  await btn.click();
  await page.locator('.sn-confirm-overlay .sn-confirm-btn-ok').click();
  await expect.poll(async () => (await getSettings(page)).terminal?.enabled).toBe(true);
  await expect(btn).toContainText('✓');
});

test('livello 3: il bottone resta bloccato finché non si digita "conferma"', async ({ openTab }) => {
  const page = await openTab(NEWTAB);

  await page.evaluate(() => {
    window.__typedResult = undefined;
    window.SN_CONFIRM_UI.confirmTyped({ title: 'Eliminazione', text: 'Eliminare tutto.' })
      .then((r) => { window.__typedResult = r; });
  });

  const overlay = page.locator('.sn-confirm-overlay');
  const ok = overlay.locator('.sn-confirm-btn-danger');
  const input = overlay.locator('.sn-confirm-input');
  await expect(ok).toBeDisabled();

  // Parola sbagliata → ancora bloccato.
  await input.fill('confermo');
  await expect(ok).toBeDisabled();

  // Parola giusta → si sblocca ed esegue.
  await input.fill('conferma');
  await expect(ok).toBeEnabled();
  await ok.click();
  await expect(overlay).toHaveCount(0);
  expect(await page.evaluate(() => window.__typedResult)).toBe(true);
});

test('Esc annulla il popup di conferma', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await page.evaluate(() => {
    window.__confirmResult = undefined;
    window.SN_CONFIRM_UI.confirm({ text: 'Procedo?' })
      .then((r) => { window.__confirmResult = r; });
  });
  await expect(page.locator('.sn-confirm-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sn-confirm-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => window.__confirmResult)).toBe(false);
});
