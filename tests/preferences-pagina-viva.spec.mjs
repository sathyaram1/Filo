// La pagina Preferenze aperta segue i cambiamenti fatti da fuori (#667).
// Filo può cambiare le stesse impostazioni su richiesta a parole: se la pagina
// restasse ferma alla fotografia dell'apertura, il primo tocco su una qualunque
// delle sue manopole rimanderebbe indietro tutte le altre — col volume della
// suoneria a zero, il timer tornerebbe muto senza che niente lo dica.

import { test, expect } from './fixtures/electron.mjs';

const daFuori = (shell, chiave, valore) => shell.evaluate(
  ({ c, v }) => window.filoShell.message({
    type: window.SN_MSG.MSG.FILO_RUN_ACTION,
    action: { type: 'IMPOSTA_PREFERENZA', chiave: c, valore: v },
  }),
  { c: chiave, v: valore },
);

const salvate = (page) => page.evaluate(async () => {
  const r = await chrome.storage.local.get('settings');
  return (r && r.settings) || {};
});

test('una impostazione cambiata da fuori si vede nella pagina aperta', async ({ shell, openTab }) => {
  await daFuori(shell, 'volume_suoneria', 0);

  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#timerRingtoneVolume');
  await expect(prefs.locator('#timerRingtoneVolumeVal')).toHaveText('0%');

  await daFuori(shell, 'volume_suoneria', 100);
  await expect(prefs.locator('#timerRingtoneVolume')).toHaveValue('100', { timeout: 8_000 });
  await expect(prefs.locator('#timerRingtoneVolumeVal')).toHaveText('100%');

  await daFuori(shell, 'suoneria_timer', 'carillon');
  await expect(prefs.locator('#timerRingtone')).toHaveValue('chime', { timeout: 8_000 });
});

test('toccare una manopola non rimanda indietro quelle cambiate da fuori', async ({ shell, openTab }) => {
  await daFuori(shell, 'volume_suoneria', 0);

  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#timerRingtoneVolume');
  await expect(prefs.locator('#timerRingtoneVolumeVal')).toHaveText('0%');

  await daFuori(shell, 'volume_suoneria', 100);
  await daFuori(shell, 'durata_notifiche', 20);

  // Una manopola che con la suoneria non c'entra: il tema.
  await prefs.selectOption('#theme', 'dark');

  await expect.poll(async () => (await salvate(prefs)).theme, { timeout: 8_000 }).toBe('dark');
  const dopo = await salvate(prefs);
  expect(dopo.timerRingtoneVolume, 'il volume chiesto a Filo resta quello').toBe(100);
  expect(dopo.notifications.durationSec, 'e così ogni altra impostazione cambiata da fuori').toBe(20);
});

test('il campo in uso non viene riscritto sotto le dita', async ({ shell, openTab }) => {
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#agentStyleText');

  await prefs.locator('#agentStyleText').click();
  await prefs.locator('#agentStyleText').fill('sto scrivendo');
  await daFuori(shell, 'stile_agente', 'scritto da Filo');
  await prefs.waitForTimeout(1200);

  await expect(prefs.locator('#agentStyleText')).toHaveValue('sto scrivendo');
});
