// Verifica avversariale #531 — «le critiche dei verificatori si troncano a
// quattromila caratteri».
//
// IL SINTOMO, con le parole di chi ha segnalato: quando un verificatore scrive
// una critica lunga, il testo che arriva nella conversazione del feedback (e nel
// feedback figlio dei rilievi residui, che quel testo lo ricopia) si interrompe
// a metà frase. Su #509 la critica finiva su «chiusa da set» e il terzo rilievo
// arrivava monco a chi lo doveva lavorare.
//
// COSA PROVA QUESTA SPEC, dal punto di vista di chi legge il feedback:
//   1. una critica di lunghezza reale (~6000 caratteri, il caso di #509) si
//      LEGGE INTERA nella bolla della conversazione — ultima frase compresa;
//   2. se una critica supera davvero il tetto, chi legge VEDE che è stata
//      tagliata: in fondo c'è «…(testo tagliato)», non una frase che si spegne;
//   3. il taglio non spezza l'ultima parola;
//   4. una critica lunga non sfonda il riquadro: niente scorrimento
//      orizzontale, il testo va a capo.
//
// Il testo della nota lo compone la funzione VERA del canale delle routine
// (`verifierNoteText` di scripts/dispatch.mjs): è quello che il verificatore
// consegna e che il feedback poi mostra. Senza il fix la nota arriverebbe qui
// già tagliata a 4000 e gli assert 1 e 2 sarebbero rossi.

import { test, expect } from './fixtures/electron.mjs';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// dispatch.mjs legge le sue radici all'import: le puntiamo su una cartella usa
// e getta, come fa tests/unit/critiqueCap.test.mjs, così l'import non tocca il
// checkout vero né parla con git.
const TMP = mkdtempSync(resolve(tmpdir(), 'filo-v531-'));
process.env.FILO_DISPATCH_STATE_DIR = TMP;
process.env.FILO_REPO_ROOT = TMP;

const { verifierNoteText } = await import('../scripts/dispatch.mjs');
const { critiqueLimits } = await import('../scripts/lib/critique.mjs');
const LIMITS = critiqueLimits();

const FEEDBACK_URL = 'filo://feedback/feedback.html';
const SHOTS = resolve(__dirname, '.shots');

// La critica come la scrive un verificatore: rilievi numerati, e l'ULTIMO è
// quello che su #509 è arrivato monco. ~6000 caratteri: sopra il vecchio tetto,
// sotto il nuovo.
const RIEMPITIVO = Array.from({ length: 60 }, (_, i) =>
  `Rilievo ${i + 1} (livello 1) — la scheda resta aperta dopo la chiusura e il conteggio in alto non torna indietro. `).join('');
const ULTIMA_FRASE = 'Rilievo finale: la conversazione va chiusa da settembre, e questo pezzo è esattamente quello che a #509 non è mai arrivato.';
const CRITICA_REALE = `${RIEMPITIVO}${ULTIMA_FRASE}`;

async function setupAdmin(app, page, feedback) {
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 15_000 });
  await page.evaluate((fb) => {
    window.SN_FEEDBACK.list = async () => [fb];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') return { ok: true };
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'sathyarampontillo@gmail.com' } };
      }
      return orig(msg);
    };
  }, feedback);
  await page.waitForFunction(() => {
    const e = document.querySelector('.fb-empty');
    return !e || !/Caricamento/.test(e.textContent || '');
  }, null, { timeout: 15_000 });
  await app.evaluate(async ({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) { /* finestra che se ne sta andando */ }
      if (url.includes('feedback')) {
        wc.send('filo:broadcast', {
          type: 'auth_changed', signedIn: true, isAdmin: true,
          profile: { email: 'sathyarampontillo@gmail.com' },
        });
      }
    }
  });
  await page.locator('#refresh').click();
}

// Un feedback già chiuso: le sue note sono bolle di sola lettura (è la forma in
// cui l'owner rilegge l'iter di un feedback verificato).
const feedbackCon = (notes) => ({
  _id: 'v531',
  seq: 531,
  subSeq: 0,
  num: '#531',
  name: 'Verifica del tetto alla critica',
  text: 'Una critica lunga deve arrivare intera a chi la legge.',
  status: 'done',
  statusPublic: 'closed',
  url: 'https://example.com',
  clientId: 'tester-531',
  notes,
  createdAt: '2026-09-04T10:00:00.000Z',
  images: [],
});

test('una critica di lunghezza reale si legge INTERA nella conversazione del feedback', async ({ app, openTab }) => {
  const nota = verifierNoteText('fail', `FAIL — ${CRITICA_REALE}`);
  // Pre-condizione del test: il caso è davvero quello di #509 (oltre 4000, sotto
  // il tetto nuovo) e la nota non ha avuto niente da tagliare.
  expect(nota.length).toBeGreaterThan(4000);
  expect(nota.length).toBeLessThanOrEqual(LIMITS.max);
  expect(nota).not.toContain(LIMITS.mark.trim());

  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(app, page, feedbackCon(nota));

  await page.locator('[data-tab="resolved"]').click();
  const bolla = page.locator('.fb-bubble--model .fb-bubble-body').last();
  await expect(bolla).toBeVisible({ timeout: 15_000 });

  // SUCCESSO dal punto di vista di chi legge: l'ULTIMO rilievo c'è. È il pezzo
  // che su #509 mancava, ed è ciò che rende inutile la critica quando manca.
  const testo = await bolla.innerText();
  expect(testo, 'l’ultimo rilievo della critica deve arrivare a chi legge').toContain(ULTIMA_FRASE);
  expect(testo, 'una critica sotto il tetto non porta segni di taglio').not.toContain('testo tagliato');

  // …e non sfonda il riquadro: il testo va a capo, la pagina non scorre di lato.
  const sfonda = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(sfonda, 'una nota lunga non deve far scorrere la pagina in orizzontale').toBe(false);

  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: resolve(SHOTS, 'v531-critica-intera.png'), fullPage: false });
});

test('una critica oltre il tetto si vede che è stata tagliata, e non a metà parola', async ({ app, openTab }) => {
  const enorme = `FAIL — ${'Un rilievo lungo che si ripete parola per parola fino a sfondare il tetto dichiarato. '.repeat(400)}`;
  const nota = verifierNoteText('fail', enorme);

  expect(nota.length, 'il segno del taglio sta DENTRO il tetto').toBeLessThanOrEqual(LIMITS.max);
  expect(nota.endsWith(LIMITS.mark), 'chi legge deve sapere che sta leggendo un pezzo').toBe(true);
  // Non a metà parola: prima del segno finisce una parola intera del testo.
  const prima = nota.slice(0, nota.length - LIMITS.mark.length);
  expect(/(?:^|\s)(?:tetto|dichiarato\.|Un|rilievo|lungo|che|si|ripete|parola|per|fino|a|sfondare|il)$/.test(prima),
    `il taglio deve cadere a fine parola, non dentro (finisce con: ${JSON.stringify(prima.slice(-30))})`).toBe(true);

  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(app, page, feedbackCon(nota));

  const bolla = page.locator('.fb-bubble .fb-bubble-body').last();
  await expect(bolla).toBeVisible({ timeout: 15_000 });
  const testo = await bolla.innerText();
  expect(testo, 'il segno del taglio deve arrivare fino a chi legge').toContain('testo tagliato');

  const sfonda = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(sfonda, 'nemmeno la nota al massimo del tetto sfonda di lato').toBe(false);

  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: resolve(SHOTS, 'v531-critica-tagliata.png'), fullPage: false });
});
