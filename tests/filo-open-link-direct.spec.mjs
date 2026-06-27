// #162 / #159 — Filo ESEGUE invece di mostrare bottoni inerti.
//
// #162: quando l'utente chiede di aprire un link, Filo lo apre DIRETTAMENTE in
//   una nuova scheda (non si limita a un bottone da cliccare); e quando l'unica
//   cosa che fa è aprire un link, non scrive testo di riempimento ("(vuoto)").
// #159: le modifiche alle impostazioni (preferenza/estetica) di livello 2 aprono
//   il loro popup di conferma da SOLE, senza richiedere un click sul bottone.
//
// Gli assert verificano il SUCCESSO (la scheda si apre davvero; il popup compare
// da solo; il chip ha un'etichetta leggibile), non l'assenza di un errore.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

// Conta le finestre/scheda (WebContentsView) che puntano a un certo URL.
function findWindow(app, url) {
  return app.windows().find((w) => {
    try { return w.url() === url; } catch (_) { return false; }
  });
}

test('#162 — NAVIGA apre il link DIRETTAMENTE in una nuova scheda', async ({ app, testServer, openTab }) => {
  // Una scheda iniziale per assestare il boot (la newtab esiste già).
  await openTab(NEWTAB);
  const url = testServer.html('<!doctype html><title>Filo target</title><h1>aperto</h1>');

  // Prima dell'azione: nessuna scheda su quell'URL.
  expect(findWindow(app, url)).toBeFalsy();

  const r = await execAction(app, { type: 'NAVIGA', url });
  expect(r.executed).toBe(true);
  expect(r.kept).toBe(true);
  expect(r.opened).toBe(true);

  // Dopo l'azione: la scheda esiste DAVVERO (il link si è aperto da solo).
  await expect.poll(() => !!findWindow(app, url), { timeout: 8_000 }).toBe(true);
});

test('#162 — il chip del link ha SEMPRE un\'etichetta leggibile (niente bottone misterioso)', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  // NAVIGA senza etichetta: il chip deve ripiegare sull\'hostname, non restare
  // un favicon muto.
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'test-naviga';
    document.body.appendChild(host);
    window.__filoDashActions.renderActions(host, [{ type: 'NAVIGA', url: 'https://www.youtube.com/watch?v=x' }]);
  });
  const chip = page.locator('#test-naviga .dash-action-link-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('youtube.com');
});

test('#159 — un\'impostazione di livello 2 apre il popup di conferma da SOLA', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  // gestione_cookie → privacy è una preferenza sensibile (livello 2). Filo
  // l\'ha già "decisa": il client deve aprire il popup di conferma senza che
  // l\'utente clicchi nulla.
  const action = {
    type: 'IMPOSTA_PREFERENZA', chiave: 'gestione_cookie', valore: 'privacy',
    _confirm: { level: 2, text: 'Impostare: Gestione cookie → Privacy' },
  };
  await page.evaluate((a) => {
    const host = document.createElement('div');
    host.id = 'test-autoconfirm';
    document.body.appendChild(host);
    window.__filoDashActions.renderActions(host, [a], { autoConfirm: true });
  }, action);

  // Il popup compare DA SOLO (nessun click sul bottone).
  const overlay = page.locator('.sn-confirm-overlay');
  await expect(overlay).toBeVisible({ timeout: 4_000 });
  await expect(overlay).toContainText('Gestione cookie');
});

test('#159 — le azioni distruttive (livello 3) e i comandi NON si auto-confermano', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  // Un comando da terminale (anche se confermabile) NON deve aprire il popup da
  // solo: resta a click esplicito.
  const action = {
    type: 'ESEGUI_COMANDO', comando: 'rm -rf /',
    _confirm: { level: 3, text: 'Eseguire nel terminale: rm -rf /' },
  };
  await page.evaluate((a) => {
    const host = document.createElement('div');
    host.id = 'test-noauto';
    document.body.appendChild(host);
    window.__filoDashActions.renderActions(host, [a], { autoConfirm: true });
  }, action);

  // Niente popup automatico.
  await page.waitForTimeout(300);
  await expect(page.locator('.sn-confirm-overlay')).toHaveCount(0);
});
