// Audit: bacheca (filo://board/board.html) — stato vuoto e comportamento base.
//
// Tre verifiche:
//   1. La pagina carica senza errori JS e i suoi elementi strutturali esistono.
//   2. Stato vuoto: quando non ci sono fix in produzione, mostra il messaggio
//      "Nessun miglioramento da verificare per ora." (e non una pagina bianca/
//      rotta).
//   3. Voto da anonimo: il pulsante di voto è presente; se l'utente non è
//      autenticato, il clic avvia il flusso di login (il pulsante #bdSignIn è
//      visibile, non viene mostrato un crash né un messaggio senza senso).
//
// Come i test in board-page.spec.mjs, usa window.__boardTest per iniettare dati
// sintetici dopo che il caricamento reale (FB.list → Firestore) si è concluso,
// così l'ambiente headless senza credenziali non interferisce.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = resolve(__dirname, '.shots');
const URL = 'filo://board/board.html';

// Fix in produzione (per i test che ne hanno bisogno).
const SHIPPED = {
  _id: 'fb-audit-shipped',
  name: 'Fix di test per audit',
  status: 'done',
  priority: 3,
  resolvedInVersion: '0.2.71',
  seq: 99, subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-06-20T10:00:00Z',
  votes: {},
};

// Aspetta che la pagina abbia terminato il caricamento iniziale (il loader
// scompare o compaiono dati/stato vuoto), poi inietta dati sintetici.
async function seedBoard(page, { items = [], signedIn = null, version = '0.2.71' } = {}) {
  // Aspetta i moduli shared + hook di test esposto da board.js.
  await page.waitForFunction(
    () => window.__boardTest && window.SN_FEEDBACK && window.SN_MANAGE_REVIEW,
    null,
    { timeout: 15_000 },
  );
  // Aspetta che il caricamento live (FB.list) sia terminato: solo dopo siamo
  // sicuri che setData non venga sovrascritto.
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 15_000 });

  await page.evaluate(({ list, email, ver }) => {
    window.__boardTest.setReleasedVersion(ver);
    if (email) window.__boardTest.setSignedIn(email);
    window.__boardTest.setData(list);
  }, { list: items, email: signedIn, ver: version });
}

// ── Teardown: assicura che la cartella degli screenshot esista ────────────────
test.beforeAll(() => {
  try { mkdirSync(SHOTS_DIR, { recursive: true }); } catch (_) {}
});

// ── 1. La pagina carica e gli elementi strutturali esistono ──────────────────
test('la pagina bacheca carica senza errori e mostra gli elementi strutturali', async ({ openTab }) => {
  const errors = [];
  const page = await openTab(URL);
  page.on('pageerror', (err) => errors.push(err.message));

  await page.waitForLoadState('domcontentloaded');

  // Titolo e sottotitolo della bacheca devono essere presenti.
  await expect(page.locator('h1')).toHaveText('Bacheca');
  await expect(page.locator('.bd-head p')).toBeVisible();

  // La sezione auth deve essere presente (il suo contenuto varia con lo stato).
  await expect(page.locator('.bd-auth')).toBeVisible();

  // Almeno uno dei tre stati del contenuto (loading, empty, list) è nel DOM.
  const loading = page.locator('#bdLoading');
  const empty   = page.locator('#bdEmpty');
  const list    = page.locator('#bdList');
  const anyPresent = await Promise.all([
    loading.isVisible(),
    empty.isVisible(),
    list.isVisible(),
  ]);
  expect(anyPresent.some(Boolean), 'Almeno uno tra #bdLoading, #bdEmpty e #bdList deve essere visibile').toBe(true);

  // Screenshot della pagina caricata.
  await page.screenshot({ path: `${SHOTS_DIR}/audit-board-empty.png` });

  // Nessun errore JS non gestito.
  expect(errors, `Errori JS inattesi: ${errors.join('; ')}`).toHaveLength(0);
});

// ── 2. Stato vuoto: messaggio significativo invece di pagina bianca ───────────
test('stato vuoto: mostra messaggio "Nessun miglioramento da verificare per ora."', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  // Inietta lista vuota: nessun fix in produzione.
  await seedBoard(page, { items: [] });

  // Il loader deve sparire.
  await expect(page.locator('#bdLoading')).toBeHidden();

  // Il messaggio di stato vuoto deve essere visibile e leggibile.
  const empty = page.locator('#bdEmpty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('Nessun miglioramento da verificare per ora');

  // Nessuna scheda-fix (lista vuota).
  await expect(page.locator('.bd-card')).toHaveCount(0);

  // Il blocco lista deve restare nascosto (non mostrare contenitore vuoto).
  await expect(page.locator('#bdList')).toBeHidden();

  await page.screenshot({ path: `${SHOTS_DIR}/audit-board-empty-state.png` });
});

// ── 3. Voto da anonimo: il pulsante voto è presente e il login viene richiesto ─
test('anonimo: i pulsanti voto esistono e #bdSignIn è visibile prima del login', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  // Inietta un fix in produzione senza simulare un utente autenticato.
  await seedBoard(page, { items: [SHIPPED], signedIn: null });

  // La scheda del fix deve comparire.
  await expect(page.locator('.bd-card')).toHaveCount(1);

  // I pulsanti di voto devono essere presenti.
  const worksBtn  = page.locator('.bd-card .bd-vote-works');
  const brokenBtn = page.locator('.bd-card .bd-vote-broken');
  await expect(worksBtn).toBeVisible();
  await expect(brokenBtn).toBeVisible();

  // In stato anonimo, il pulsante "Accedi" deve essere visibile (invito al login).
  await expect(page.locator('#bdSignIn')).toBeVisible();

  // L'utente non autenticato clicca "Funziona": la pagina non crasha (il click
  // avvia il flusso di login). Verifica che dopo il click la pagina sia ancora
  // in uno stato valido (elementi strutturali presenti, nessun errore visibile).
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await worksBtn.click();

  // Piccola attesa per far completare l'IPC (può tornare un errore, non un crash).
  await page.waitForTimeout(500);

  // La struttura della pagina deve sopravvivere al click da anonimo.
  await expect(page.locator('h1')).toHaveText('Bacheca');
  await expect(page.locator('.bd-auth')).toBeVisible();

  expect(errors, `Errori JS dopo click da anonimo: ${errors.join('; ')}`).toHaveLength(0);

  await page.screenshot({ path: `${SHOTS_DIR}/audit-board-anon-vote.png` });
});
