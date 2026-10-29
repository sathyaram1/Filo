// Verifica #1433, giro 5, rilievo 2: Commenta dal pannello con del testo già selezionato commenta quel testo, invece di
// chiedere di selezionarlo di nuovo.
import { test, expect } from '../../fixtures/electron.mjs';

test('r2 testo selezionato, Commenta dal pannello: si apre il nuovo commento su quel testo', async ({ openTab }) => {
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="comment"]'));
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta gamma delta');
  await ed.keyboard.press('Control+A');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'))).toBe(true);
  await ed.waitForTimeout(300);
  await ed.locator('.pd-elemento[data-elemento="comment"] .ed-cm-nuovo').click();
  await expect(ed.locator('#cmText')).toBeVisible({ timeout: 3000 });
  await expect(ed.locator('#overlay')).toContainText('alfa beta gamma delta');
});
