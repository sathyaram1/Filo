// #1433 giro 6, rilievo 2: Ctrl+F apre il pannello sul campo Cerca; Esc lì svuota la ricerca ma non chiude il pannello
// né riporta al foglio: quello che si scrive dopo va nel campo Cerca.
import { test, expect } from '../../fixtures/electron.mjs';
import { EDITOR, pannelloAperto } from '../../helpers/strumentiEditor.mjs';

test('r2 Ctrl+F, cerca, Esc: il pannello si chiude e si torna a scrivere nel foglio', async ({ openTab }) => {
  const ed = await openTab(EDITOR);
  await ed.waitForSelector('.pd-elemento[data-elemento="word-count"]', { state: 'attached' });
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta gamma alfa');
  await ed.keyboard.press('Control+f');
  await expect.poll(() => pannelloAperto(ed)).toBe(true);
  await ed.keyboard.type('alfa');
  await ed.keyboard.press('Enter');
  await ed.keyboard.press('Escape');
  await ed.keyboard.press('Escape');
  await expect.poll(() => pannelloAperto(ed), { timeout: 2000 }).toBe(false);
  await ed.keyboard.type('X');
  await expect(ed.locator('#doc')).toContainText('X');
});
