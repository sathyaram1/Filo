// Verifica #545.1 giro 2: modificatori coi nomi italiani o sconosciuti, nomi
// italiani dei tasti speciali, inserimenti strani nel campo della scorciatoia.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

async function apri(openTab) {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
  return page;
}

async function impostaScorciatoia(page, testo, tipo = 'word-count') {
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeVisible();
  await page.locator(`.ed-module[data-type="${tipo}"]`).click();
  await expect(page.locator('#cfgShortcut')).toBeVisible();
  await page.fill('#cfgShortcut', testo);
  await page.click('#cfgSave');
}

async function esci(page) {
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeHidden();
}

// Il rilievo del giro 1: Maiusc e Opzione devono contare davvero alla pressione.
const MODIFICATORI = [
  ['Ctrl+Maiusc+2', 'Control+Shift+Digit2', 'Control+Digit2'],
  ['Ctrl+Opzione+2', 'Control+Alt+Digit2', 'Control+Digit2'],
  ['Comando+Maiuscolo+K', 'Control+Shift+KeyK', 'Control+KeyK'],
];
for (const [scritto, giusto, sbagliato] of MODIFICATORI) {
  test(`«${scritto}» parte con la combinazione intera e non senza il modificatore`, async ({ openTab }) => {
    const page = await apri(openTab);
    await impostaScorciatoia(page, scritto);
    await expect(page.locator('#cfgShortcut')).toBeHidden();
    await esci(page);
    await page.click('#doc');
    await page.keyboard.press(sbagliato);
    await page.waitForTimeout(300);
    await expect(page.locator('#overlay')).toBeHidden();
    await page.keyboard.press(giusto);
    await expect(page.locator('#overlay')).toContainText('Statistiche documento');
  });
}

for (const scritto of ['Ctrl+AltGr+2', 'Ctrl+Win+2', 'Ctrl+Pippo+2', 'Pippo+Ctrl+2']) {
  test(`«${scritto}» si rifiuta nominando il pezzo sconosciuto`, async ({ openTab }) => {
    const page = await apri(openTab);
    await impostaScorciatoia(page, scritto);
    await expect(page.locator('#cfgShortcut')).toHaveClass(/ed-field-invalid/);
    const pezzo = scritto.split('+').find((p) => !/^(ctrl|2)$/i.test(p));
    await expect(page.locator('#cfgShortcutTaken')).toContainText(pezzo);
  });
}

const NOMI_ITALIANI = [
  ['Ctrl+Barra spaziatrice', 'Control+Space'],
  ['Ctrl+Pag Su', 'Control+PageUp'],
  ['Ctrl+PagSu', 'Control+PageUp'],
  ['Ctrl+Pag giù', 'Control+PageDown'],
  ['Ctrl+Pausa', 'Control+Pause'],
  ['Ctrl+Alt+Fine', 'Control+Alt+End'],
];
for (const [scritto, premuto] of NOMI_ITALIANI) {
  test(`«${scritto}» si salva e parte`, async ({ openTab }) => {
    const page = await apri(openTab);
    await impostaScorciatoia(page, scritto);
    await expect(page.locator('#cfgShortcut')).toBeHidden();
    await esci(page);
    await page.click('#doc');
    await page.keyboard.press(premuto);
    await expect(page.locator('#overlay')).toContainText('Statistiche documento');
  });
}

// Inserimenti strani: nessuno si salva in silenzio, l'avviso resta testo.
for (const scritto of ['Ctrl+', 'Ctrl+😀x', 'Ctrl+<b>x</b>', `Ctrl+${'a'.repeat(3000)}`, 'Ctrl+Stamp']) {
  test(`«${scritto.slice(0, 20)}» non si salva in silenzio`, async ({ openTab }) => {
    const page = await apri(openTab);
    await impostaScorciatoia(page, scritto);
    await expect(page.locator('#cfgShortcut')).toBeVisible();
    await expect(page.locator('#cfgShortcut')).toHaveClass(/ed-field-invalid/);
    expect(await page.locator('#overlayBox b, #overlay b').count()).toBe(0);
  });
}

test('l\'avviso sul modificatore sconosciuto, tema scuro', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.emulateMedia({ colorScheme: 'dark' });
  await impostaScorciatoia(page, 'Ctrl+AltGr+2');
  await expect(page.locator('#cfgShortcutTaken')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/verifica-545-1-g2-mod-scuro.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: 'tests/.shots/verifica-545-1-g2-mod-chiaro.png' });
});

// Due moduli con la stessa combinazione (anche scritta con due nomi): il secondo
// non partirebbe mai, quindi o si rifiuta o parte.
test('una scorciatoia già data a un altro modulo non si salva in silenzio', async ({ openTab }) => {
  const page = await apri(openTab);
  await impostaScorciatoia(page, 'Ctrl+Shift+Space');
  await expect(page.locator('#cfgShortcut')).toBeHidden();
  await esci(page);
  await page.locator('.ed-switch-icon').nth(1).click();
  await expect(page.locator('.ed-module[data-type="comment"]')).toBeVisible();
  await impostaScorciatoia(page, 'Ctrl+Maiusc+Spazio', 'comment');
  if (await page.locator('#cfgShortcut').isVisible()) {
    await expect(page.locator('#cfgShortcut')).toHaveClass(/ed-field-invalid/);
    return;
  }
  await esci(page);
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+Space');
  await expect(page.locator('.commenting')).toHaveCount(1);
});
