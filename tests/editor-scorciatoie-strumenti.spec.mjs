// #1433 — la scorciatoia di uno strumento dell'Editor vale dentro e fuori dal pannello: quella scelta nelle Impostazioni
// per uno strumento che non c'è, quella di uno strumento tolto, e Ctrl+F che riporta Cerca e sostituisci.
import { test, expect } from './fixtures/electron.mjs';
import { EDITOR, strumento, apriImpostazioni, aggiungiStrumento } from './helpers/strumentiEditor.mjs';

const elementi = (ed) => ed.evaluate(() => [...document.querySelectorAll('.pd-elementi > .pd-elemento')].map((n) => n.dataset.elemento));
const esegui = (app, a) => app.evaluate((_e, x) => globalThis.SN_EXECUTE_FILO_ACTION(x), a);
const salvata = (app, id) => app.evaluate(async (_e, i) => ((await globalThis.SN_STORAGE.getRaw('sn_pannelli_app', null))?.editor?.config?.[i]?.shortcut) || '', id);

async function apriEditor(openTab) {
  const ed = await openTab(EDITOR);
  await ed.waitForFunction(() => document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  return ed;
}

async function daiScorciatoia(app, ed, id, scritta) {
  await apriImpostazioni(ed, id);
  await ed.fill('#cfgShortcut', scritta);
  await ed.click('#cfgSave');
  await expect.poll(() => salvata(app, id)).toBe(scritta);
}

async function scriviESeleziona(ed) {
  await ed.click('#doc');
  await ed.keyboard.type('ciao');
  await ed.keyboard.press('Control+A');
}

test('una scorciatoia data dalle Impostazioni al Corsivo, che non sta nel pannello, mette il corsivo', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await aggiungiStrumento(ed, 'settings');
  await daiScorciatoia(app, ed, 'italic', 'Alt+K');
  expect(await elementi(ed)).not.toContain('italic');
  await scriviESeleziona(ed);
  await ed.keyboard.press('Alt+KeyK');
  await expect(ed.locator('#doc i, #doc em')).toHaveText('ciao');
});

test('tolto dal pannello, il Corsivo tiene la sua scorciatoia', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await aggiungiStrumento(ed, 'italic');
  await daiScorciatoia(app, ed, 'italic', 'Alt+K');
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'togli', elemento: 'italic' });
  await expect.poll(() => elementi(ed)).not.toContain('italic');
  await ed.keyboard.press('Escape');
  await scriviESeleziona(ed);
  await ed.keyboard.press('Alt+KeyK');
  await expect(ed.locator('#doc i, #doc em')).toHaveText('ciao');
});

test('Ctrl+F con Cerca e sostituisci tolto dal pannello lo rimette e porta al suo campo', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'togli', elemento: 'search-replace' });
  await expect.poll(() => elementi(ed)).toEqual(['word-count', 'comment']);
  await ed.click('#doc');
  await ed.keyboard.type('il gatto e il cane');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const wc = win._filoTabs.tabs.find((x) => x.id === win._filoTabs.activeId).view.webContents;
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: ['control'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: ['control'] });
  });
  await expect(strumento(ed, 'search-replace').locator('[data-sr="find"]')).toBeFocused();
  await ed.keyboard.type('il');
  await expect(ed.locator('#doc mark.ed-find-hit')).toHaveCount(2);
});
