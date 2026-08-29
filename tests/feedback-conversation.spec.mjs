// La conversazione di un feedback si mostra a TURNI (bolle), non in un unico
// blocco — feedback #108 (parte 3): "un feedback ha testo originale, risposta
// del modello, mia risposta, altre domande… ogni turno in un box diverso".
//
// Pre-condizione che senza il fix fallirebbe: prima esisteva una sola
// `.fb-notes-readonly` con tutto il testo incollato; ora ci sono bolle distinte
// `.fb-bubble--report` / `--model` (Filo) / `--user` (Tu), in ordine
// cronologico. E nel tab Chiarimenti la risposta dell'utente si invia col
// composer (che appende la risposta allo storico e riporta il feedback in
// "Da risolvere"), non editando un blob di note.
//
// Come la spec del fuoco note, mockiamo SN_FEEDBACK.list e intercettiamo
// window.filo.message per restare deterministici e offline (admin simulato).

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

// Simula l'admin loggato (broadcast + intercetta auth_status) e installa un mock
// di lista. Ritorna dopo che il load d'avvio è finito e la lista è ridisegnata.
async function setupAdmin(app, page, feedback, captureUpdates = false) {
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 8_000 });

  await page.evaluate(({ fb, capture }) => {
    window.SN_FEEDBACK.list = async () => [fb];
    if (capture) window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        if (window.__updates) window.__updates.push(msg);
        return { ok: true };
      }
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'sathyarampontillo@gmail.com' } };
      }
      return orig(msg);
    };
  }, { fb: feedback, capture: captureUpdates });

  await page.waitForFunction(() => {
    const e = document.querySelector('.fb-empty');
    return !e || !/Caricamento/.test(e.textContent || '');
  }, null, { timeout: 10_000 });

  await app.evaluate(async ({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
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

test('un feedback risolto mostra la conversazione a bolle distinte (Segnalazione → Filo → Tu)', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  const notes = [
    'Ho aggiunto il tasto copia al menu. Verificato con un test.',
    '',
    '--- Riaperto il 20/05/26, 19:37 ---',
    'Manca ancora il caso con due immagini.',
  ].join('\n');

  await setupAdmin(app, page, {
    _id: 'mock-convo-1',
    status: 'done',
    text: 'manca il tasto copia quando seleziono il testo',
    url: 'https://example.com',
    clientId: 'tester-123', // feedback umano → segnalazione lato utente
    notes,
    createdAt: new Date().toISOString(),
  });

  await page.locator('[data-tab="resolved"]').click();

  // Tre bolle distinte (NON un unico blocco): segnalazione + nota Filo + risposta.
  await expect(page.locator('.fb-bubble--report')).toContainText('tasto copia quando seleziono');
  await expect(page.locator('.fb-bubble--model')).toContainText('Ho aggiunto il tasto copia al menu');
  await expect(page.locator('.fb-bubble--user:not(.fb-bubble--report)')).toContainText('Manca ancora il caso con due immagini');

  // L'ordine cronologico delle etichette: Segnalazione → Filo → Tu.
  const whos = await page.locator('.fb-bubble-who').allTextContents();
  expect(whos).toEqual(['Segnalazione', 'Filo', 'Tu']);

  // Il vecchio blob unico non esiste più.
  await expect(page.locator('.fb-notes-readonly')).toHaveCount(0);
});

test('riaprire + ri-risolvere conserva report iniziale, nota utente e nuovo report dell’agente (4 bolle)', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  // Stato dopo che una routine ha RI-risolto un feedback riaperto: il nuovo
  // report dell'agente è appeso col marcatore "Aggiornamento dell'agente del…",
  // SENZA cancellare report precedente + annotazione di riapertura dell'utente.
  // Era il bug "riaprendo perdo la risposta dell'agente e la mia nota".
  const notes = [
    'Ho aggiunto lo zoom con Ctrl +.',
    '',
    '--- Riaperto il 16/06/26, 22:00 ---',
    'Manca lo zoom col trackpad (pinch).',
    '',
    "--- Aggiornamento dell'agente del 17/06/26, 09:00 ---",
    'Ora supporto anche il pinch sul trackpad.',
  ].join('\n');

  await setupAdmin(app, page, {
    _id: 'mock-reopen-1',
    status: 'done',
    text: 'rendi possibile zoommare anche col trackpad',
    url: 'https://example.com',
    clientId: 'tester-123',
    notes,
    createdAt: new Date().toISOString(),
  });

  await page.locator('[data-tab="resolved"]').click();

  // Tutto è ancora lì, in 4 bolle distinte e nell'ordine giusto.
  const whos = await page.locator('.fb-bubble-who').allTextContents();
  expect(whos).toEqual(['Segnalazione', 'Filo', 'Tu', 'Filo']);
  await expect(page.locator('.fb-bubble--report')).toContainText('zoommare anche col trackpad');
  await expect(page.locator('.fb-bubble--user:not(.fb-bubble--report)')).toContainText('Manca lo zoom col trackpad');
  // Due bolle lato MODELLO (Filo): il report iniziale e il nuovo aggiornamento —
  // il secondo NON è attribuito all'utente.
  await expect(page.locator('.fb-bubble--model')).toHaveCount(2);
  await expect(page.locator('.fb-bubble--model').first()).toContainText('Ho aggiunto lo zoom con Ctrl');
  await expect(page.locator('.fb-bubble--model').last()).toContainText('Ora supporto anche il pinch');
});

test('nel tab Chiarimenti la risposta si invia col composer: appende lo storico e torna in Da risolvere', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  await setupAdmin(app, page, {
    _id: 'mock-clarify-1',
    status: 'clarify',
    text: 'aggiungi il modello TTS',
    url: 'https://example.com',
    clientId: 'tester-123',
    notes: 'Quale provider preferisci per il TTS: OpenAI, Gemini o ElevenLabs?',
    createdAt: new Date().toISOString(),
  }, /* captureUpdates */ true);

  await page.locator('[data-tab="clarify"]').click();

  // La domanda di Filo è una bolla; il composer è presente.
  await expect(page.locator('.fb-bubble--model')).toContainText('Quale provider preferisci');
  const reply = page.locator('.fb-reply-text');
  await expect(reply).toBeVisible();

  await reply.click();
  await reply.fill('Usa Gemini come predefinito, le voci di sistema come fallback.');
  await page.locator('.fb-reply-send').click();

  // La scrittura inviata al main: status todo + note che conservano DOMANDA e
  // RISPOSTA (lo storico non si perde).
  const upd = await page.waitForFunction(
    () => (window.__updates || []).find((m) => m.id === 'mock-clarify-1'),
    null, { timeout: 5_000 },
  ).then((h) => h.jsonValue());

  expect(upd.status).toBe('todo');
  expect(upd.notes).toContain('Quale provider preferisci'); // domanda conservata
  expect(upd.notes).toContain('Usa Gemini come predefinito'); // risposta appesa
  // Il blob risultante riparsa in 2 turni: nota di Filo + risposta utente.
  expect(upd.notes).toMatch(/La tua risposta del/);
});
