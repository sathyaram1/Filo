// Feedback #PIP "Migliorare gestione commenti e allegati", parte 2: l'admin
// deve poter COMMENTARE un feedback appena ricevuto (sezione "Ricevuti"), non
// solo quelli già presi in carico, e il commento deve viaggiare con lo
// spostamento in coda ("commenta POI metti in coda").
//
// Pre-condizione che senza il fix fallirebbe: prima la casella commento
// (`.fb-notes`) era editabile SOLO sui feedback già in lavorazione — sui
// "Ricevuti" non compariva affatto, quindi il primo assert (textarea visibile)
// sarebbe rosso. Qui asseriamo il SUCCESSO: la casella c'è, e il testo digitato
// finisce nel payload di aggiornamento quando si clicca "→ In coda".
//
// Come le altre spec della dashboard feedback (vedi feedback-conversation):
// mockiamo SN_FEEDBACK.list e intercettiamo window.filo.message per restare
// deterministici e offline (admin simulato). Il tab di default è "Ricevuti".

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

// Un feedback "ricevuto" (status new) di un alpha tester esterno.
const SAMPLE = {
  _id: 'mock-inbox-1',
  clientId: 'tester-abc',
  status: 'new',
  text: 'Il pulsante condividi non fa nulla',
  url: 'https://example.com/x',
  createdAt: '2026-06-17T00:00:00.000Z',
  notes: '',
};

// Simula l'admin loggato + mock della lista, poi ricarica. Resta sul tab di
// default ("Ricevuti"). Se capture, raccoglie i feedback_update in __updates.
async function setupAdmin(app, page, feedback, capture = false) {
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 8_000 });
  await page.evaluate(({ fb, cap }) => {
    window.SN_FEEDBACK.list = async () => [fb];
    if (cap) window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        if (window.__updates) window.__updates.push(msg);
        return { ok: true };
      }
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'owner@example.com' } };
      }
      return orig(msg);
    };
  }, { fb: feedback, cap: capture });

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
          profile: { email: 'owner@example.com' },
        });
      }
    }
  });

  await page.locator('#refresh').click();
}

test('Ricevuti: l\'admin vede la casella commento su un feedback "new"', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(app, page, SAMPLE);

  const ta = page.locator('.fb-notes[data-id="mock-inbox-1"]');
  await expect(ta).toBeVisible();
  // Etichetta orientata al commento (non "Note / decisioni di design").
  await expect(page.locator('.fb-card .fb-notes-label')).toContainText('Commento');
});

test('Ricevuti: il commento viaggia con lo spostamento in "In coda"', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(app, page, SAMPLE, true);

  // Impostiamo il testo senza dare/togliere fuoco alla casella: così evitiamo
  // che il salvataggio su blur ridisegni la card proprio mentre clicchiamo il
  // bottone. Verifichiamo il cammino canonico: "→ In coda" porta con sé il
  // commento già scritto (il gestore .fb-act legge la textarea).
  await page.evaluate(() => {
    document.querySelector('.fb-notes[data-id="mock-inbox-1"]').value = 'Ho riprodotto, è un bug reale';
  });
  await page.locator('.fb-act[data-id="mock-inbox-1"][data-to="todo"]').click();

  await expect.poll(() => page.evaluate(() => (window.__updates || []).length)).toBeGreaterThan(0);
  const upd = await page.evaluate(() => window.__updates.find((u) => u.status === 'todo'));
  expect(upd).toBeTruthy();
  expect(upd.notes).toContain('Ho riprodotto, è un bug reale');
});

test('senza admin la casella commento NON compare sui Ricevuti (sola lettura)', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await page.evaluate((fb) => { window.SN_FEEDBACK.list = async () => [fb]; }, SAMPLE);
  await page.locator('#refresh').click();
  await page.waitForFunction(() => {
    const e = document.querySelector('.fb-empty');
    return !e || !/Caricamento/.test(e.textContent || '');
  }, null, { timeout: 10_000 });
  // Card presente ma in sola lettura: nessuna casella commento.
  await expect(page.locator('.fb-card')).toHaveCount(1);
  await expect(page.locator('.fb-notes[data-id="mock-inbox-1"]')).toHaveCount(0);
});
