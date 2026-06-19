// Interruttore master dell'auto-miglioramento (owner-only) nella dashboard feedback.
//
// Lo switch "Gestione automatica dei feedback" controlla se i feedback "sicuri"
// vengono gestiti in autonomia — e quindi se del codice generato automaticamente
// può arrivare a TUTTI gli utenti. È un controllo critico: solo l'owner (admin)
// può toccarlo. Su userData pulito non c'è sessione admin, quindi:
//   - lo switch è nel DOM ma NON è visibile (è una "zona proprietario");
//   - il main RIFIUTA automation_get/automation_set da non-admin (il vero gate:
//     anche aggirando la UI, non si legge né si scrive il flag senza un admin).
//
// Pre-condizione che senza il gate fallirebbe: un non-admin che chiama
// automation_set riceverebbe ok:true e potrebbe ATTIVARE l'autonomia per tutti.
// Col gate torna ok:false.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

test('automazione: lo switch esiste ma è nascosto ai non-admin', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  // Da sloggato la pagina è in sola lettura (stesso segnale del gating triage).
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 8_000 });

  // Il markup dello switch è presente in pagina...
  await expect(page.locator('#automationToggle')).toHaveCount(1);
  // ...ma il contenitore resta nascosto: è un controllo da proprietario.
  await expect(page.locator('#automationRow')).toBeHidden();
});

test('automazione: il main rifiuta automation_get/set da utente non admin', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 8_000 });

  // Lettura del flag: rifiutata (non è un admin).
  const get = await page.evaluate(() => window.filo.message({ type: 'automation_get' }));
  expect(get).toBeTruthy();
  expect(get.ok).toBe(false);
  expect(String(get.error || '')).toMatch(/amministrator/i);

  // Il caso critico: un non-admin NON deve poter ATTIVARE l'autonomia.
  const set = await page.evaluate(() => window.filo.message({ type: 'automation_set', enabled: true }));
  expect(set).toBeTruthy();
  expect(set.ok).toBe(false);
  expect(String(set.error || '')).toMatch(/amministrator/i);
});
