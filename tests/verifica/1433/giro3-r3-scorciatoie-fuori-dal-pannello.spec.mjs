// Verifica #1433, giro 3, rilievo 3: una scorciatoia data a uno strumento vale anche quando lo strumento non sta nel pannello.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';
const elementi = (ed) => ed.evaluate(() => [...document.querySelectorAll('.pd-elementi > .pd-elemento')].map((n) => n.dataset.elemento));
const esegui = (app, a) => app.evaluate((_e, x) => globalThis.SN_EXECUTE_FILO_ACTION(x), a);

async function daiScorciatoia(app, ed, id, scritta) {
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'settings' });
  await expect.poll(() => elementi(ed)).toContain('settings');
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'apri' });
  await ed.locator('.pd-elemento[data-elemento="settings"] button').click();
  await ed.locator(`[data-strumento="${id}"]`).click();
  await ed.fill('#cfgShortcut', scritta);
  await ed.click('#cfgSave');
  await expect.poll(() => app.evaluate(async (_e, i) => ((await globalThis.SN_STORAGE.getRaw('sn_pannelli_app', null))?.editor?.config?.[i]?.shortcut) || '', id)).toBe(scritta);
}

async function scriviESeleziona(ed) {
  await ed.click('#doc');
  await ed.keyboard.type('ciao');
  await ed.keyboard.press('Control+A');
}

test('r3 Alt+K data al Corsivo dalle Impostazioni degli strumenti, col Corsivo fuori dal pannello, mette il corsivo', async ({ app, openTab }) => {
  const ed = await openTab(EDITOR);
  await ed.waitForFunction(() => document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  await daiScorciatoia(app, ed, 'italic', 'Alt+K');
  expect(await elementi(ed)).not.toContain('italic');
  await scriviESeleziona(ed);
  await ed.keyboard.press('Alt+KeyK');
  await expect(ed.locator('#doc i, #doc em')).toHaveText('ciao');
});

test('r3 tolto dal pannello il Corsivo con la sua Alt+K, la scorciatoia continua a mettere il corsivo', async ({ app, openTab }) => {
  const ed = await openTab(EDITOR);
  await ed.waitForFunction(() => document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'italic' });
  await daiScorciatoia(app, ed, 'italic', 'Alt+K');
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'togli', elemento: 'italic' });
  await expect.poll(() => elementi(ed)).not.toContain('italic');
  await scriviESeleziona(ed);
  await ed.keyboard.press('Alt+KeyK');
  await expect(ed.locator('#doc i, #doc em')).toHaveText('ciao');
});
