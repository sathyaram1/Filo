// Verifica #1433, giro 2, rilievo 1: salvare le impostazioni di uno strumento non chiude il pannello da cui le si è aperte.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';
const aperto = (ed) => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'));

test('r1 dopo «Salva» nelle impostazioni del Conteggio il pannello resta aperto e mostra il nuovo conteggio', async ({ openTab }) => {
  const ed = await openTab(EDITOR);
  await ed.waitForFunction(() => document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  await ed.click('#doc');
  await ed.keyboard.type('uno due tre');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.click('.pd-elemento[data-elemento="word-count"] .pd-contenuto', { button: 'right' });
  await ed.locator('.pd-menu .sn-select-option', { hasText: 'Impostazioni di' }).click();
  await ed.selectOption('#cfgCount', 'chars');
  await ed.click('#cfgSave');
  await expect(ed.locator('.pd-elemento[data-elemento="word-count"]')).toContainText('11');
  await ed.waitForTimeout(500);
  expect(await aperto(ed)).toBe(true);
  await expect(ed.locator('.pd-elemento[data-elemento="word-count"]')).toBeVisible();
});
