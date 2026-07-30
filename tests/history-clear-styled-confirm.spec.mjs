// Feedback #275 (estensione per parità di cammini): le conferme delle azioni
// distruttive nelle pagine filo:// devono usare il popup stilizzato di Filo
// (SN_CONFIRM_UI), non il confirm() nativo del browser. Oltre a "Svuota
// archivio" (vedi tab-archive.spec.mjs) qui verifichiamo "Cancella tutto"
// della Cronologia AI.
//
// ASSERISCE il successo: cliccando "Cancella tutto" compare l'host del dialogo
// stilizzato (.sn-confirm-host) e NON viene generato un dialogo nativo. Pre-fix
// la pagina chiamava confirm() nativo: rosso (host mai visibile).

import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST } from './helpers/confirm.mjs';

test('Cronologia AI: "Cancella tutto" usa il popup stilizzato, non il confirm nativo', async ({ openTab }) => {
  const page = await openTab('filo://history/history.html');
  await page.waitForLoadState('domcontentloaded');

  // Il modulo delle conferme è caricato dalla pagina.
  expect(await page.evaluate(() => typeof window.SN_CONFIRM_UI)).toBe('object');

  // Se ricomparisse il confirm nativo Playwright lo intercetterebbe qui.
  let nativeDialog = false;
  page.on('dialog', async (d) => { nativeDialog = true; await d.dismiss().catch(() => {}); });

  await page.locator('#clear').click();

  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  expect(nativeDialog, 'nessun confirm nativo del browser deve comparire').toBe(false);
});
