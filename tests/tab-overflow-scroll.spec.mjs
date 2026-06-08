// Overflow della tab bar con molte tab (spec §6).
//
// ASSERISCE il successo: con molte schede aperte la striscia delle tab NON le
// clippa fuori vista, ma diventa scrollabile orizzontalmente (scrollWidth >
// clientWidth) e la scheda ATTIVA viene portata in vista. Senza il fix la
// striscia aveva overflow:hidden e le tab in eccesso sparivano.

import { test, expect } from './fixtures/electron.mjs';

test('con molte tab la striscia scrolla e tiene in vista la tab attiva', async ({ shell }) => {
  // Apri molte schede interne (leggere) per superare la larghezza della barra.
  const N = 30;
  await shell.evaluate(async (n) => {
    for (let i = 0; i < n; i++) window.filoShell.tabs.open('filo://newtab/');
  }, N);

  // Aspetta che la shell abbia renderizzato abbastanza schede.
  await expect.poll(async () => shell.evaluate(
    () => document.querySelectorAll('#tabs .tab').length,
  ), { timeout: 15_000 }).toBeGreaterThanOrEqual(N);

  // La striscia è in overflow → è scrollabile (non clippata).
  const dims = await shell.evaluate(() => {
    const tabsEl = document.getElementById('tabs');
    return { scrollW: tabsEl.scrollWidth, clientW: tabsEl.clientWidth };
  });
  expect(dims.scrollW).toBeGreaterThan(dims.clientW);

  // La scheda attiva (l'ultima aperta) è effettivamente in vista nella striscia.
  const inView = await expect.poll(async () => shell.evaluate(() => {
    const tabsEl = document.getElementById('tabs');
    const active = tabsEl.querySelector('.tab.active');
    if (!active) return false;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    const viewL = tabsEl.scrollLeft;
    const viewR = viewL + tabsEl.clientWidth;
    // tollera 2px di arrotondamento
    return right <= viewR + 2 && left >= viewL - 2;
  }), { timeout: 8_000 }).toBe(true);
  expect(inView).toBe(true);
});
