// FEEDBACK (alpha) "Gestione errata delle bolle": riaprendo un feedback (o
// aggiungendo dettagli), la spiegazione finiva DENTRO la stessa casella della
// nota dell'agente ("--- Riaperto il … ---" come testo nella textarea), invece
// di comparire come una BOLLA separata, divisa dalla segnalazione e dalla nota.
//
// Contratto (asserisce il SUCCESSO):
//   • nei tab dove l'admin lavora (es. "Da risolvere") la textarea editabile
//     contiene SOLO la nota dell'agente (il "capo"), non il testo di riapertura;
//   • la riapertura compare come bolla di sola lettura separata, sotto la nota;
//   • salvando una modifica alla nota, la riapertura (la "coda") resta intatta.
//
// Pre-condizione che senza il fix fallirebbe: prima l'intero blob `notes`
// (nota + "--- Riaperto il … ---") cadeva nella textarea → l'assert "la
// textarea NON contiene il testo di riapertura" sarebbe rosso, e non esisterebbe
// alcuna bolla separata per la riapertura.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

// Un feedback "Da risolvere" con: nota dell'agente + una riapertura dell'utente.
const SAMPLE = {
  _id: 'mock-reopen-1',
  clientId: 'owner:abc',
  status: 'todo',
  text: 'Il bagliore audio non si vede',
  url: 'https://example.com',
  createdAt: '2026-06-17T00:00:00.000Z',
  notes: 'Ho aggiunto il bagliore e l\'icona audio.\n\n--- Riaperto il 17/06/26, 17:47 ---\nnon vedo cambiamenti di nessun tipo',
};

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

test('la riapertura è una bolla separata, non dentro la casella della nota', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(app, page, SAMPLE);
  await page.locator('[data-tab="queue"]').click();

  const card = page.locator('.fb-card');
  await expect(card).toHaveCount(1);

  // 1) La textarea editabile contiene SOLO la nota dell'agente (il capo).
  const ta = card.locator('.fb-notes[data-id="mock-reopen-1"]');
  await expect(ta).toHaveValue('Ho aggiunto il bagliore e l\'icona audio.');
  // …e NON il testo di riapertura.
  const taVal = await ta.inputValue();
  expect(taVal).not.toContain('non vedo cambiamenti');
  expect(taVal).not.toContain('Riaperto il');

  // 2) La riapertura compare come bolla di sola lettura separata (coda).
  const tailBubble = card.locator('.fb-thread--tail .fb-bubble');
  await expect(tailBubble).toHaveCount(1);
  await expect(tailBubble).toContainText('non vedo cambiamenti');
  await expect(tailBubble.locator('.fb-bubble-who')).toHaveText('Tu');
});

test('modificando la nota, la riapertura (coda) resta intatta nel salvataggio', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await setupAdmin(app, page, SAMPLE, true);
  await page.locator('[data-tab="queue"]').click();

  const card = page.locator('.fb-card');
  // Cambio il testo della nota e clicco "✓ Risolto": il salvataggio deve
  // CONSERVARE la riapertura come turno separato.
  await page.evaluate(() => {
    document.querySelector('.fb-notes[data-id="mock-reopen-1"]').value = 'Nota aggiornata: ora il bagliore si vede.';
  });
  await card.locator('.fb-act[data-id="mock-reopen-1"][data-to="done"]').click();

  await expect.poll(() => page.evaluate(() => (window.__updates || []).length)).toBeGreaterThan(0);
  const upd = await page.evaluate(() => window.__updates.find((u) => u.status === 'done'));
  expect(upd).toBeTruthy();
  // La nota aggiornata C'È…
  expect(upd.notes).toContain('Nota aggiornata: ora il bagliore si vede.');
  // …e la riapertura dell'utente NON è stata persa.
  expect(upd.notes).toContain('--- Riaperto il 17/06/26, 17:47 ---');
  expect(upd.notes).toContain('non vedo cambiamenti di nessun tipo');
});
