// Verifica #842, giro 2: le prove dei rilievi 1, 2, 3 e 4.
import { test, expect } from '../../fixtures/electron.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';
const EDITOR = 'filo://editor/editor.html';

const chiedi = (app, valore) => app.evaluate((_e, v) => globalThis.SN_EXECUTE_FILO_ACTION(
  { type: 'IMPOSTA_PREFERENZA', chiave: 'scorciatoia', valore: v }, { sender: null }), valore);
const scelte = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).scorciatoie || {});
const riga = (page, id) => page.locator(`#scorciatoieFilo .sc-riga[data-azione="${id}"]`);
const tasti = (page, id) => riga(page, id).locator('.sc-tasti');

// Spiega su Alt+Shift+E, Traduci su Alt+E, e un modulo dell'Editor sul vecchio Alt+T: Traduci non può tornare di serie.
async function preparaScambio(app, openTab) {
  expect((await chiedi(app, 'Spiega: Alt+Shift+E')).executed).toBe(true);
  expect((await chiedi(app, 'Traduci: Alt+E')).executed).toBe(true);
  const ed = await openTab(EDITOR);
  await expect(ed.locator('#doc')).toBeVisible();
  await ed.locator('.ed-module[data-type="settings"]').click();
  await ed.locator('.ed-module[data-type="word-count"]').click();
  await ed.fill('#cfgShortcut', 'Alt+T');
  await ed.click('#cfgSave');
  await expect(ed.locator('#overlay')).toBeHidden();
}

test('r1 «tutte di serie» detto a Filo: quello che dice di aver rimesso di serie lo è davvero', async ({ app, openTab }) => {
  await preparaScambio(app, openTab);
  const r = await chiedi(app, 'tutte di serie');
  const detto = JSON.stringify(r.output);
  const s = await scelte(app);
  // Se Filo dice che Spiega è tornata di serie, deve esserlo; se non può, lo deve dire.
  if (/Spiega/.test(detto.split('tranne')[0])) expect(s['explain-selection'] || '').toBe('');
  else expect(detto).toContain('Spiega');
});

test('r1 «Ripristina i tasti di serie» in Preferenze: una riga che resta com\'era dice perché', async ({ app, openTab }) => {
  await preparaScambio(app, openTab);
  const page = await openTab(PREFERENZE);
  await expect(page.locator('#scorciatoieFilo .sc-riga')).toHaveCount(4);
  await page.locator('#scorciatoieRipristina').click();
  await expect(riga(page, 'translate-selection').locator('.sc-errore')).toBeVisible();
  await expect.poll(async () => {
    const tornata = ((await scelte(app))['explain-selection'] || '') === '';
    const spiegata = await riga(page, 'explain-selection').locator('.sc-errore').isVisible();
    return tornata || spiegata;
  }, { timeout: 3000 }).toBe(true);
});

test('r2 mentre una riga ascolta, il clic sui tasti di un\'altra riga la mette in ascolto', async ({ openTab, app }) => {
  const page = await openTab(PREFERENZE);
  await expect(page.locator('#scorciatoieFilo .sc-riga')).toHaveCount(4);
  await tasti(page, 'translate-selection').click();
  await expect(riga(page, 'translate-selection')).toHaveClass(/sc-registra/);
  await tasti(page, 'explain-selection').click();
  await expect(riga(page, 'explain-selection')).toHaveClass(/sc-registra/, { timeout: 2000 });

  // Anche il ↺ di un'altra riga, cliccato mentre una ascolta, fa quello che dice.
  await page.keyboard.press('Escape');
  expect((await chiedi(app, 'Aiuto: Alt+Shift+K')).executed).toBe(true);
  await expect(tasti(page, 'open-help-sidebar')).toHaveText('Alt+Shift+K');
  await tasti(page, 'translate-selection').click();
  await expect(riga(page, 'translate-selection')).toHaveClass(/sc-registra/);
  await riga(page, 'open-help-sidebar').locator('.sc-ripristina').click();
  await expect(tasti(page, 'open-help-sidebar')).toHaveText('Alt+H', { timeout: 2000 });
});

test('r3 il ↺ di una riga cambiata resta accanto ai suoi tasti anche quando la riga mostra un rifiuto', async ({ app, openTab }) => {
  expect((await chiedi(app, 'Traduci: Ctrl+Shift+Y')).executed).toBe(true);
  expect((await chiedi(app, 'Spiega: Ctrl+Shift+U')).executed).toBe(true);
  const page = await openTab(PREFERENZE);
  await expect(page.locator('#scorciatoieFilo .sc-riga')).toHaveCount(4);
  await tasti(page, 'translate-selection').click();
  await page.keyboard.press('Control+t');
  await expect(riga(page, 'translate-selection').locator('.sc-errore')).toBeVisible();
  const conRifiuto = await riga(page, 'translate-selection').locator('.sc-ripristina').boundingBox();
  const senza = await riga(page, 'explain-selection').locator('.sc-ripristina').boundingBox();
  expect(Math.abs(conRifiuto.x - senza.x)).toBeLessThan(40);
});

test('r4 Ctrl+Invio, che nelle pagine di Filo invia il feedback e le risposte, si rifiuta per le quattro azioni', async ({ app }) => {
  const r = await chiedi(app, 'Traduci: Ctrl+Invio');
  expect(r.executed).toBe(false);
});
