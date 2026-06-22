import { test, expect } from './fixtures/electron.mjs';

// Audit (routine): la pagina Sicurezza offre "Esporta dati (.zip)" e la sua
// descrizione promette esplicitamente "Utile come backup o per trasferire i
// dati su un altro computer" — ma NON esiste alcun controllo per RE-IMPORTARE
// quel file. L'invariante UX "se puoi esportare, devi poter importare" è
// rotta, e la promessa di trasferire i dati è irrealizzabile.
test('Sicurezza: esiste Esporta ma manca qualunque Importa', async ({ openTab }) => {
  const page = await openTab('filo://security/security.html');
  await page.waitForLoadState('domcontentloaded');

  // Il bottone di export esiste ed è visibile (feature presente).
  const exportBtn = page.locator('#sec-export-btn');
  await expect(exportBtn).toBeVisible();
  const exportLabel = (await exportBtn.textContent())?.trim() || '';
  expect(exportLabel.toLowerCase()).toContain('esporta');

  // La descrizione promette il trasferimento dati su un altro computer.
  const desc = (await page.locator('#sec-export-desc').textContent())?.trim() || '';
  expect(desc.toLowerCase()).toContain('trasferire i dati su un altro computer');

  await page.screenshot({ path: 'tests/.shots/audit-export-no-import.png' });

  // NESSUN controllo di import in tutta la pagina: né per id, né per etichetta,
  // né un <input type=file>. Questo assert FALLISCE non appena l'import esiste.
  const importById = await page.locator('#sec-import-btn').count();
  const fileInputs = await page.locator('input[type="file"]').count();
  const importByText = await page
    .locator('button:has-text("Importa"), button:has-text("Carica"), button:has-text("Ripristina")')
    .count();

  expect(importById).toBe(0);
  expect(fileInputs).toBe(0);
  expect(importByText).toBe(0);
});
