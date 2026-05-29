// Gating admin del triage feedback.
//
// La gestione dei feedback (spostare di stato, priorità, note) è riservata
// agli amministratori loggati. Su userData pulito NON c'è sessione, quindi:
//   - la pagina feedback mostra il banner "sola lettura" + pulsante Accedi;
//   - non compaiono pulsanti d'azione (.fb-act);
//   - il main RIFIUTA qualsiasi feedback_update con { ok:false } (è il vero
//     gate: anche aggirando la UI, la scrittura non parte senza un admin).
//
// Pre-condizione che senza il fix fallirebbe: prima del gating chiunque poteva
// spostare un feedback in "todo". Ora feedback_update da sloggato torna ok:false.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

test('feedback: da sloggato la pagina è in sola lettura (banner + niente azioni)', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  // Il banner di sola lettura deve comparire (auth_status → non admin).
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('#adminSignIn')).toBeVisible();

  // Nessun pulsante d'azione di triage in pagina.
  await expect(page.locator('.fb-act')).toHaveCount(0);
});

test('feedback: il main rifiuta feedback_update da utente non admin', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 8_000 });

  // Tentativo diretto di scrittura (come farebbe la UI): deve essere rifiutato
  // dal main perché non c'è un admin loggato.
  const res = await page.evaluate(() =>
    window.filo.message({ type: 'feedback_update', id: 'non-esiste', status: 'todo' })
  );
  expect(res).toBeTruthy();
  expect(res.ok).toBe(false);
  expect(String(res.error || '')).toMatch(/amministrator/i);
});
