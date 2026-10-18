// Verifica #667 — giro 1: la suoneria che suona è quella scelta.
//
// In Preferenze si sceglie fra quattro motivi e si può ascoltarli con «Prova».
// Se l'anteprima suonasse il motivo scelto e la scadenza un altro, la scelta
// sarebbe finta: qui si guarda quale motivo la finestra manda davvero in onda.

import { test, expect } from '../../fixtures/electron.mjs';

test('il motivo scelto in Preferenze è quello che parte alla scadenza', async ({ shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#timerRingtone', { timeout: 8_000 });
  await prefs.locator('#timerRingtone').selectOption('chime');
  await expect
    .poll(() => prefs.evaluate(async () => (await window.SN_STORAGE.getSettings()).timerRingtone), { timeout: 5_000 })
    .toBe('chime');

  // Intercetta il motivo che la shell chiede, senza toccare il resto.
  await shell.evaluate(() => {
    const vero = window.SN_SOUNDS.ring;
    window.__motivi = [];
    window.SN_SOUNDS.ring = (id) => { window.__motivi.push(id); return vero.call(window.SN_SOUNDS, id); };
  });

  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate((t) => window.filoShell.message({ type: t, label: 'Caffè', seconds: 2 }), tipo);

  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 12_000 });
  expect(await shell.evaluate(() => window.SN_SOUNDS.state())).toBe('running');
  expect(await shell.evaluate(() => window.__motivi)).toContain('chime');
  expect(await shell.evaluate(() => window.__motivi.every((m) => m === 'chime'))).toBe(true);
});
