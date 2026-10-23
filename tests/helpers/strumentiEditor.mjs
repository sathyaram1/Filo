// Gli strumenti dell'Editor nel pannello di destra e la sua chat, l'Aiuto (#1433), mossi coi gesti dell'utente.
// Le prove li aprono, li aggiungono e li regolano da qui; dal main si semina solo quello che c'era prima della prova.

import { expect } from '@playwright/test';

export const EDITOR = 'filo://editor/editor.html';

export const strumento = (page, id) => page.locator(`.pd-elemento[data-elemento="${id}"]`);
export const pannelloAperto = (page) => page.evaluate(() => document.documentElement.classList.contains('pd-aperto'));
export const strumentiNelPannello = (page) => page.evaluate(() => [...document.querySelectorAll('.pd-elementi > .pd-elemento')].map((n) => n.dataset.elemento));

// Aperto col tasto resta aperto finché non si clicca fuori: aperto col clic si chiude al primo passaggio del puntatore
// sul foglio, anche quello di un riquadro che si chiude sotto il cursore fermo.
export async function apriPannello(page) {
  await page.waitForSelector('.pd-pannello', { state: 'attached' });
  if (!(await pannelloAperto(page))) await page.keyboard.press('Control+Backslash');
  await expect.poll(() => pannelloAperto(page)).toBe(true);
}

// Gli strumenti come li conserva il main, scritti prima di aprire (o ricaricare) l'Editor. In fondo c'è sempre
// l'ingranaggio, che non sta fra quelli di partenza: vederlo vuol dire che la pagina ha letto questi.
export async function seminaStrumenti(app, elementi, config = {}) {
  const lista = [...elementi.filter((id) => id !== 'settings'), 'settings'];
  await app.evaluate((_e, v) => globalThis.SN_STORAGE.setRaw('sn_pannelli_app', v), { editor: { elementi: lista, config, migrato: true } });
}
export async function aspettaStrumenti(page) {
  await page.waitForSelector('#doc');
  await page.waitForSelector('.pd-elemento[data-elemento="settings"]', { state: 'attached' });
}

export const strumentiSalvati = (app) => app.evaluate(async () => {
  const v = await globalThis.SN_STORAGE.getRaw('sn_pannelli_app', null);
  return (v && v.editor) || null;
});

// Dal «+»: la voce del catalogo cliccata va in fondo al pannello; il secondo clic sul «+» chiude il catalogo.
export async function aggiungiStrumento(page, id) {
  await apriPannello(page);
  await page.click('.pd-piu');
  await page.click(`.pd-catalogo .pd-voce[data-elemento="${id}"]`);
  await expect(strumento(page, id)).toHaveCount(1);
  await page.click('.pd-piu');
  await expect(page.locator('.pd-catalogo')).toBeHidden();
}

// Dove si fa il tasto destro su uno strumento: sui campi di testo resta il menu del testo.
const BERSAGLIO = { 'search-replace': '[data-sr="all"]', font: '.ed-font-button' };

// Le regolazioni di uno strumento: dall'ingranaggio, che li elenca tutti, o dal tasto destro sullo strumento nel pannello.
export async function apriImpostazioni(page, id, { via = 'ingranaggio' } = {}) {
  await apriPannello(page);
  if (via === 'menu') {
    await strumento(page, id).locator(BERSAGLIO[id] || '.pd-contenuto').first().click({ button: 'right' });
    await page.locator('.pd-menu .sn-select-option', { hasText: 'Impostazioni di' }).click();
  } else {
    await strumento(page, 'settings').locator('.ed-strumenti-btn').click();
    await page.locator(`#overlay [data-strumento="${id}"]`).click();
  }
  await expect(page.locator('#cfgSave')).toBeVisible();
}

// L'Aiuto della scheda davanti, come l'icona della barra a sinistra: nell'Editor è la chat del documento.
export async function apriAiuto(app, page) {
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1' && typeof window.SN_SIDEBAR?.open === 'function');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help');
  });
  await expect(page.locator('.sn-sidebar-input textarea')).toBeVisible();
}
export async function chiediAllAiuto(page, domanda) {
  await page.fill('.sn-sidebar-input textarea', domanda);
  await page.press('.sn-sidebar-input textarea', 'Enter');
}
