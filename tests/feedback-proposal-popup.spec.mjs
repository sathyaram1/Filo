// #414 — La segnalazione che Filo propone dopo aver ammesso una mancanza.
//
// Tre cose devono valere sul popup di conferma (l'unico posto dove l'utente
// legge cosa partirebbe a suo nome):
//   1. si apre DA SOLO quando la proposta compare in chat, non dopo un click
//      su un chip (la sidebar già faceva così: qui mancava la simmetria);
//   2. mostra il testo INTERO — niente "…" a metà frase: chi conferma deve
//      poter leggere tutto quello che sta autorizzando;
//   3. la selezione del testo usa la palette di Filo, non il blu di sistema.

import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, confirmText, clickConfirm } from './helpers/confirm.mjs';

const NEWTAB = 'filo://newtab/';

// Testo lungo come quello che Filo compone da sé (ben oltre i 160 caratteri a
// cui il popup si fermava): la CODA è la parte che spariva dietro i puntini.
const CODA = 'e questa è la coda della segnalazione, quella che prima non si vedeva.';
const TESTO = 'L\'utente ha richiesto di chiudere tutte le tab tranne quella attuale. '
  + 'Non esiste un\'azione disponibile per chiudere schede specifiche o tutte tranne una '
  + 'dall\'assistente, quindi la richiesta non è stata soddisfatta. '
  + `Mi piacerebbe che Filo sapesse farlo. ${CODA}`;

// Chiede al main la descrizione REALE dell'azione (registro dei livelli), così
// lo spec esercita il percorso di produzione e non una stringa inventata qui.
const proposeFeedback = (app) =>
  app.evaluate((_electron, action) => globalThis.SN_EXECUTE_FILO_ACTION(action), {
    type: 'INVIA_FEEDBACK', testo: TESTO, titolo: 'chiudere le altre schede',
  });

test('la segnalazione proposta apre il popup da sola e mostra il testo per intero', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);

  // Livello 2: il main NON invia, rimanda la spiegazione per il popup.
  const r = await proposeFeedback(app);
  expect(r.executed).toBe(false);
  expect(r.needsConfirm).toBe(2);
  // La descrizione porta il testo integrale, coda compresa.
  expect(r.describe).toContain(CODA);
  expect(r.describe).not.toContain('…');

  const action = { type: 'INVIA_FEEDBACK', testo: TESTO, titolo: 'chiudere le altre schede', _confirm: { level: 2, text: r.describe } };

  // Risposta FRESCA della chat: nessun click: il popup deve comparire da sé.
  await page.evaluate((a) => {
    const host = document.createElement('div');
    host.id = 'test-proposal';
    document.body.appendChild(host);
    window.__filoDashActions.renderActions(host, [a], { autoConfirm: true });
  }, action);

  const host = page.locator(CONFIRM_HOST);
  await expect(host).toBeVisible();
  await expect.poll(() => confirmText(page)).toContain('feedback');

  // Il testo è tutto lì: inizio, coda e nessuna ellissi di troncamento.
  const shown = await confirmText(page);
  expect(shown).toContain('L\'utente ha richiesto di chiudere');
  expect(shown).toContain(CODA);
  expect(shown).not.toContain('…');

  // Il chip in chat NON è stato cliccato da nessuno: è rimasto lì come ripiego.
  const btnText = await page.locator('#test-proposal .dash-action-btn').textContent();
  expect(btnText).not.toContain('✓');
  // …e non si porta dietro i due punti che annunciavano il testo del popup.
  expect(btnText.trim().endsWith(':')).toBe(false);

  // Annulla: niente parte senza l'OK (il gate di livello 2 resta quello di prima).
  await clickConfirm(page, 'cancel');
  await expect(host).toHaveCount(0);
});

test('nel popup la selezione del testo è nella palette Filo, non nel blu di sistema', async ({ openTab }) => {
  const page = await openTab(NEWTAB);

  await page.evaluate(() => {
    window.SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'x'.repeat(4000) });
  });
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();

  // Colore atteso: quello del token del tema, risolto dalla pagina (così il
  // test segue gli override estetici invece di inchiodare un letterale).
  const expected = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'var(--sn-selection-bg)';
    document.body.appendChild(probe);
    const v = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return v;
  });
  // Il token deve risolvere davvero in un colore (non trasparente): altrimenti
  // il confronto qui sotto passerebbe per il motivo sbagliato.
  expect(expected).not.toBe('rgba(0, 0, 0, 0)');

  const state = await confirmState(page);
  expect(state.selectionBg).toBe(expected);

  // Controprova: uno shadow root gemello SENZA la regola ::selection non eredita
  // il colore dal foglio del documento — è per questo che la regola deve stare
  // dentro il dialogo, e questo assert diventa rosso se qualcuno la toglie.
  const bare = await page.evaluate(() => {
    const h = document.createElement('div');
    document.body.appendChild(h);
    const root = h.attachShadow({ mode: 'open' });
    const p = document.createElement('div');
    p.textContent = 'testo';
    root.appendChild(p);
    const v = getComputedStyle(p, '::selection').backgroundColor;
    h.remove();
    return v;
  });
  expect(bare).not.toBe(expected);

  // Il testo lungo scorre dentro il box invece di essere tagliato via.
  expect(state.textScrolls).toBe(true);

  await clickConfirm(page, 'cancel');
});
