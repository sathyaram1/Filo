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

// Fa scorrere il testo del dialogo fino in fondo: OK si accende solo dopo (#592).
export async function scrollConfirmToEnd(page) {
  const done = await page.evaluate(() => window.SN_CONFIRM_UI._test.scrollToEnd());
  expect(done, 'testo del dialogo presente').toBe(true);
}

// Clic vero del mouse su un bottone del dialogo, anche su OK in attesa (#592).
export async function mouseClickConfirm(page, which = 'ok') {
  const p = await page.evaluate((w) => window.SN_CONFIRM_UI._test.point(w), which);
  expect(p, `bottone di conferma "${which}" presente`).toBeTruthy();
  await page.mouse.click(p.x, p.y);
}

// Centro del bottone nell'istante in cui il dialogo compare: è il clic che
// l'utente aveva già in corso per altro (#592). null se non compare entro 15 s.
export function pointWhenConfirmAppears(page, which = 'ok') {
  return page.evaluate((w) => new Promise((resolve) => {
    const t0 = performance.now();
    const giro = () => {
      const p = window.SN_CONFIRM_UI && window.SN_CONFIRM_UI._test.point(w);
      if (p) return resolve(p);
      if (performance.now() - t0 > 15_000) return resolve(null);
      requestAnimationFrame(giro);
    };
    giro();
  }), which);
}

// Scrive nel campo di testo del dialogo livello 3 (digita-la-parola).
export async function fillConfirmInput(page, value) {
  const filled = await page.evaluate((v) => window.SN_CONFIRM_UI._test.fill(v), value);
  expect(filled, 'campo di testo del dialogo presente').toBe(true);
}

function rgba(s) {
  const t = String(s || '');
  let m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(t);
  if (m) return [m[1], m[2], m[3]].map((x) => Number(x) * 255).concat(m[4] == null ? 1 : Number(m[4]));
  m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/.exec(t);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] == null ? 1 : Number(m[4])] : null;
}

// Quanto il filo a sinistra del riquadro (stato di confirmState) si stacca dallo
// sfondo del popup, da 0 a 255 sul canale peggiore: sotto una sessantina non si vede.
export function staccoDelFilo(s) {
  const c = rgba(s && s.riquadro && s.riquadro.bordo);
  const b = rgba(s && s.riquadro && s.riquadro.bgBox);
  if (!c || !b || !(parseFloat(s.riquadro.bordoSinistro) >= 2)) return 0;
  return Math.max(...[0, 1, 2].map((i) => Math.abs(c[i] * c[3] + b[i] * (1 - c[3]) - b[i])));
}
