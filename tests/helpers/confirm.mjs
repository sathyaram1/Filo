// Helper per gli spec che interagiscono col dialogo di conferma di Filo
// (SN_CONFIRM_UI). Dal fix del feedback #249 il dialogo vive in uno Shadow DOM
// CHIUSO (anti auto-click dagli script della pagina), quindi i locator
// Playwright NON possono raggiungere bottoni/testo/input al suo interno.
//
// - Per asserire PRESENZA/ASSENZA del dialogo usa l'host (`CONFIRM_HOST`):
//   è l'unico nodo visibile nel DOM del documento (copre il viewport).
// - Per leggere il contenuto o interagire, gli spec sulle pagine filo://
//   (contextIsolation:false) passano dagli hook SN_CONFIRM_UI._test via
//   page.evaluate. Sulle pagine web esterne gli hook vivono nel mondo isolato
//   del preload e NON sono raggiungibili dalla pagina.

import { expect } from '../fixtures/electron.mjs';

export const CONFIRM_HOST = '.sn-confirm-host';

// Stato del dialogo aperto: { title, text, okDisabled, hasInput } | null.
export function confirmState(page) {
  return page.evaluate(() => (window.SN_CONFIRM_UI && window.SN_CONFIRM_UI._test.state()) || null);
}

// Titolo+testo del dialogo aperto ('' se chiuso) — comodo con expect.poll(...).toContain(...).
export async function confirmText(page) {
  const s = await confirmState(page);
  return s ? `${s.title}\n${s.text}` : '';
}

// Attende che il dialogo sia aperto e clicca un bottone: 'ok' | 'cancel' | 'danger'.
export async function clickConfirm(page, which = 'ok', opts = {}) {
  await expect(page.locator(CONFIRM_HOST)).toBeVisible(opts);
  const clicked = await page.evaluate((w) => window.SN_CONFIRM_UI._test.click(w), which);
  expect(clicked, `bottone di conferma "${which}" presente e abilitato`).toBe(true);
}

// Scrive nel campo di testo del dialogo livello 3 (digita-la-parola).
export async function fillConfirmInput(page, value) {
  const filled = await page.evaluate((v) => window.SN_CONFIRM_UI._test.fill(v), value);
  expect(filled, 'campo di testo del dialogo presente').toBe(true);
}
