// Chiusa una scheda col puntatore sulla fila, lasciata la fila le schede rimaste si allargano subito,
// senza aspettare che un'altra scheda cambi titolo o carichi (#428 fuso con l'avviso audio di #431).
import { test, expect } from '../../fixtures/electron.mjs';

test('lasciata la fila dopo una chiusura, le schede si allargano subito', async ({ shell }) => {
  await shell.evaluate(async () => { for (let i = 0; i < 15; i++) await window.filoShell.tabs.open('filo://newtab/'); });
  await expect(shell.locator('#tabs .tab')).toHaveCount(16, { timeout: 15_000 });
  await shell.waitForTimeout(1500);
  const p = await shell.evaluate(() => {
    const r = document.querySelectorAll('#tabs .tab')[5].querySelector('.close').getBoundingClientRect();
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
  });
  await shell.mouse.move(p.x, p.y);
  await shell.mouse.click(p.x, p.y);
  await expect(shell.locator('#tabs .tab')).toHaveCount(15, { timeout: 8_000 });
  await shell.waitForTimeout(800);

  // Rilascio e misura nello stesso giro di JS: nessun aggiornamento delle schede può ridisegnare in mezzo.
  const esito = await shell.evaluate(() => {
    const inattive = () => [...document.querySelectorAll('#tabs .tab:not(.active)')];
    const prima = inattive().map((el) => el.getBoundingClientRect().width);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 300, bubbles: true }));
    const dopo = inattive().map((el) => el.getBoundingClientRect().width);
    return { prima: prima[0], dopo: dopo[0], ferme: dopo.filter((w, i) => !(w > prima[i] + 0.5)).length };
  });
  expect(esito, JSON.stringify(esito)).toMatchObject({ ferme: 0 });
});
