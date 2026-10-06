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

// Prima di un clic o di un tasto veri che devono valere come risposta: il dialogo
// li ignora per mezzo secondo dal primo fotogramma, e sotto xvfb quel fotogramma
// arriva anche un secondo dopo `toBeVisible()` (#592.11). Un'attesa fissa non basta.
export async function aspettaConfermaPronta(page) {
  await expect.poll(async () => (await confirmState(page))?.pronto, { message: 'il dialogo non accetta ancora un gesto vero' }).toBe(true);
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

// Su una pagina web il popup non sta nel documento del sito ma in una vista di Filo sopra la
// scheda (#592.6): la sua pagina è filo://shell/conferma.html, e lì valgono gli helper qui sopra.
// Ritorna quella pagina quando il popup ci è a schermo.
export async function confermaSopraPagina(app, { timeout = 10_000 } = {}) {
  const scadenza = Date.now() + timeout;
  while (Date.now() < scadenza) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://shell/conferma.html'); } catch (_) { return false; } });
    if (p && await p.evaluate(() => !!(window.SN_CONFIRM_UI && window.SN_CONFIRM_UI._test.state())).catch(() => false)) return p;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('confermaSopraPagina: il popup sopra la scheda non è comparso');
}

// Codice nel mondo isolato del preload di una scheda web, dove vivono i content script di Filo:
// page.evaluate gira nel mondo della pagina e non ci arriva. `host` è l'hostname della scheda.
export function nelMondoDiFilo(app, host, code) {
  return app.evaluate(async ({ BrowserWindow }, { host, code }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = (w._filoTabs?.tabs || []).find((x) => {
        try { return new URL(x.view.webContents.getURL()).hostname === host; } catch (_) { return false; }
      });
      // 999 è il mondo isolato dei preload di Electron.
      if (t) return t.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }]);
    }
    throw new Error(`nelMondoDiFilo: nessuna scheda su ${host}`);
  }, { host, code });
}
