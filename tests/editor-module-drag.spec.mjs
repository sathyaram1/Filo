// Feedback alpha: "nell'editor non funziona il trascinamento dei moduli; tenendo
// premuto il cursore deve cambiare in mano che afferra e devo poter trascinare".
// Verifica: afferrando l'handle di un modulo e trascinandolo su una cella vuota,
// il modulo si sposta (la sua posizione in griglia cambia) e durante il drag il
// body ha la classe .ed-dragging (cursore "mano che afferra").

import { test, expect } from './fixtures/electron.mjs';

test('editor: trascino un modulo dall\'handle in una cella vuota', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');

  const mod = page.locator('.ed-module[data-type="word-count"]');
  await expect(mod).toHaveCount(1);
  const before = await mod.evaluate((el) => `${el.style.gridColumn}|${el.style.gridRow}`);

  await mod.hover();
  const handle = mod.locator('.ed-mod-drag');
  const hbox = await handle.boundingBox();
  expect(hbox).toBeTruthy();

  // Cella vuota di destinazione (l'ultima, lontana dalla posizione iniziale).
  const empties = page.locator('.ed-cell-empty');
  const n = await empties.count();
  expect(n).toBeGreaterThan(0);
  const ebox = await empties.nth(n - 1).boundingBox();
  expect(ebox).toBeTruthy();

  await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(ebox.x + ebox.width / 2, ebox.y + ebox.height / 2, { steps: 10 });

  // Durante il drag il cursore "mano che afferra" è attivo (classe sul body).
  expect(await page.evaluate(() => document.body.classList.contains('ed-dragging'))).toBe(true);

  await page.mouse.up();

  // Il modulo si è spostato: la posizione in griglia è cambiata.
  const after = await page
    .locator('.ed-module[data-type="word-count"]')
    .evaluate((el) => `${el.style.gridColumn}|${el.style.gridRow}`);
  expect(after).not.toBe(before);

  // A drag finito il body non ha più la classe.
  expect(await page.evaluate(() => document.body.classList.contains('ed-dragging'))).toBe(false);
});
