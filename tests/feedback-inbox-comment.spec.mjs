// Feedback #PIP "Migliorare gestione commenti e allegati", parte 2: l'admin
// deve poter COMMENTARE un feedback appena ricevuto (tab "Ricevuti", status
// `new`), non solo quelli "Da risolvere", e il commento deve viaggiare con lo
// spostamento in "Da risolvere" ("commenta POI metti in da risolvere").
//
// Pre-condizione che senza il fix fallirebbe: prima la casella commento
// (`.fb-notes`) era editabile SOLO su todo/bozze/agente — sul tab "Ricevuti"
// non compariva affatto, quindi il primo assert (textarea visibile) sarebbe
// rosso. Qui asseriamo il SUCCESSO: la casella c'è, e il testo digitato finisce
// nel payload di aggiornamento quando si clicca "→ Da risolvere".

import { test, expect } from './fixtures/electron.mjs';

const PAGE = 'filo://feedback/feedback.html';

// Un feedback "ricevuto" (status new) di un alpha tester esterno.
const SAMPLE = {
  _id: 'test-inbox-1',
  clientId: 'tester-abc',
  status: 'new',
  text: 'Il pulsante condividi non fa nulla',
  url: 'https://example.com/x',
  createdAt: '2026-06-17T00:00:00.000Z',
  notes: '',
};

async function setup(page) {
  await page.waitForFunction(() => typeof window.__filoFeedbackTest?.inject === 'function', null, { timeout: 8000 });
  // Spia sul canale verso il main: cattura i feedback_update senza scrivere su rete.
  await page.evaluate(() => {
    window.__updates = [];
    const spy = (msg) => {
      if (msg && msg.type === 'feedback_update') window.__updates.push(msg);
      return Promise.resolve({ ok: true });
    };
    if (window.filo) window.filo.message = spy;
    if (window.chrome?.runtime) window.chrome.runtime.sendMessage = spy;
  });
}

test('Ricevuti: l\'admin vede la casella commento e può scrivere su un feedback "new"', async ({ openTab }) => {
  const page = await openTab(PAGE);
  await setup(page);
  await page.evaluate((f) => window.__filoFeedbackTest.inject({ items: [f], admin: true, tab: 'inbox' }), SAMPLE);

  const ta = page.locator('.fb-notes[data-id="test-inbox-1"]');
  await expect(ta).toBeVisible();
  // Etichetta orientata al commento (non "Note / decisioni di design").
  await expect(page.locator('.fb-card .fb-notes-label')).toContainText('Commento');
});

test('Ricevuti: il commento viaggia con lo spostamento in "Da risolvere"', async ({ openTab }) => {
  const page = await openTab(PAGE);
  await setup(page);
  await page.evaluate((f) => window.__filoFeedbackTest.inject({ items: [f], admin: true, tab: 'inbox' }), SAMPLE);

  // Impostiamo il testo senza dare/togliere fuoco alla casella: così evitiamo
  // che il salvataggio su blur ridisegni la card proprio mentre clicchiamo il
  // bottone. Verifichiamo il cammino canonico: "→ Da risolvere" porta con sé il
  // commento già scritto (il gestore .fb-act legge la textarea).
  await page.evaluate(() => {
    document.querySelector('.fb-notes[data-id="test-inbox-1"]').value = 'Ho riprodotto, è un bug reale';
  });
  await page.locator('.fb-act[data-id="test-inbox-1"][data-to="todo"]').click();

  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBeGreaterThan(0);
  const upd = await page.evaluate(() => window.__updates.find((u) => u.status === 'todo'));
  expect(upd).toBeTruthy();
  expect(upd.notes).toContain('Ho riprodotto, è un bug reale');
});

test('senza admin la casella commento NON compare sui Ricevuti (sola lettura)', async ({ openTab }) => {
  const page = await openTab(PAGE);
  await setup(page);
  await page.evaluate((f) => window.__filoFeedbackTest.inject({ items: [f], admin: false, tab: 'inbox' }), SAMPLE);
  await expect(page.locator('.fb-notes[data-id="test-inbox-1"]')).toHaveCount(0);
});
