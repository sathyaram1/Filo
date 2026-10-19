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
import { CONFIRM_HOST, confirmState, confirmText, clickConfirm, staccoDelFilo, confermaSopraPagina, nelMondoDiFilo } from './helpers/confirm.mjs';

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

  const action = { type: 'INVIA_FEEDBACK', testo: TESTO, titolo: 'chiudere le altre schede', _confirm: { level: 2, text: r.describe, parti: r.parti } };

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
  // Titolo e testo che partono a nome dell'utente stanno nel loro riquadro, tutti e due (#592.7).
  expect((await confirmState(page)).citazioni).toEqual(['chiudere le altre schede', TESTO]);

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

  // La controprova di uno shadow root gemello senza la regola non serve più: da Electron 44 il colore della
  // selezione si eredita anche lì dentro, dal documento che lo ospita.

  // Il testo lungo scorre dentro il box invece di essere tagliato via.
  expect(state.textScrolls).toBe(true);

  await clickConfirm(page, 'cancel');
});

// Il foglio della pagina riscrive le variabili di Filo: un accento trasparente, uno
// che non è un colore, o testo, sfondo e accento scelti insieme. Il popup resta
// quello che si vede su una pagina qualsiasi, riquadro compreso.
const FOGLI = {
  'un accento trasparente': 'body{--sn-accent:transparent}',
  'un accento che non è un colore': 'body{--sn-accent:nessuno}',
  'testo, sfondo e accento scelti insieme': '.sn-confirm-host{--sn-fg:#000;--sn-overlay-bg:#808080;--sn-accent:#fff;--sn-font:monospace}',
};

// Lo stesso sito prima e dopo aver aggiunto il suo foglio: il popup dei siti sta sopra la
// scheda (#592.6), e il foglio della pagina non lo deve raggiungere.
async function chiediDalSito(app, page) {
  const host = new URL(page.url()).hostname;
  await expect.poll(() => nelMondoDiFilo(app, host, 'typeof window.__filoSidebarTest?.runFiloAction'), { timeout: 8000 }).toBe('function');
  await nelMondoDiFilo(app, host, `window.__esito = 'in corso'; window.SN_SIDEBAR.open();
    window.__filoSidebarTest.runFiloAction(${JSON.stringify({ type: 'INVIA_FEEDBACK', testo: TESTO })}).then((v) => { window.__esito = v; }); 1`);
  const vista = await confermaSopraPagina(app, { timeout: 15_000 });
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  const annulla = async () => {
    await clickConfirm(vista, 'cancel');
    await expect.poll(() => nelMondoDiFilo(app, host, 'window.__esito')).toBe(false);
  };
  return { vista, annulla };
}

async function riquadro(app, page) {
  const { vista, annulla } = await chiediDalSito(app, page);
  const s = await confirmState(vista);
  await annulla();
  return s;
}

for (const [nome, css] of Object.entries(FOGLI)) {
  test(`#592.7 — nell’Aiuto su un sito, ${nome} nel foglio della pagina non cambia il popup né spegne il riquadro`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, '<!doctype html><html><body><h1>Ricette</h1></body></html>');
    const pulito = await riquadro(app, page);
    await page.addStyleTag({ content: css });
    const s = await riquadro(app, page);
    expect(s.citazioni).toEqual([TESTO]);
    expect(s.riquadro, 'il foglio della pagina ha cambiato il popup').toEqual(pulito.riquadro);
    expect(staccoDelFilo(s), `filo ${s.riquadro.bordo} su ${s.riquadro.bgBox}`).toBeGreaterThanOrEqual(60);
  });
}

// Fissare le variabili non deve costare la personalizzazione: sui siti il popup
// segue il tema e i colori scelti dall'utente, anche se cambiano a popup aperto.
test('#592.7 — sui siti il popup segue tema e accento dell’utente, anche a popup aperto', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const imposta = (settings) => app.evaluate(async (_e, s) => {
    await globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: s }, { url: 'filo://preferences/preferences.html' });
  }, settings);
  await imposta({ theme: 'dark', themeTokens: { accent: '#2e7d32' } });
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><h1>Ricette</h1></body></html>');
  const { vista, annulla } = await chiediDalSito(app, page);
  const stato = () => confirmState(vista);
  const scuro = await stato();
  expect(scuro.riquadro.bgBox).toBe('rgba(30, 29, 27, 0.98)');
  expect(scuro.riquadro.bg).toContain('0.180392 0.490196 0.196078');
  await vista.screenshot({ path: 'tests/.shots/conferma-sito-scuro-verde.png' });
  await imposta({ theme: 'light', themeTokens: {} });
  await expect.poll(async () => (await stato()).riquadro.bgBox, { timeout: 5000 }).toBe('rgba(248, 246, 240, 0.98)');
  expect((await stato()).riquadro.bg).toContain('0.768627 0.352941 0.231373');
  await annulla();
});
