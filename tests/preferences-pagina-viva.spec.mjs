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

// Le impostazioni avanzate salvano in due blocchi loro, che ripartono da una
// copia letta all'apertura: senza riallinearla, un colore chiesto a Filo
// («rendi i bottoni verdi») spariva al primo altro numero ritoccato.
const estetica = (shell, token, valore) => shell.evaluate(
  ({ t, v }) => window.filoShell.message({
    type: window.SN_MSG.MSG.FILO_RUN_ACTION,
    action: { type: 'IMPOSTA_ESTETICA', token: t, valore: v },
  }),
  { t: token, v: valore },
);

test('un colore chiesto a Filo resta anche dopo aver ritoccato un altro token', async ({ shell, openTab }) => {
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#tok-accent');

  await estetica(shell, 'accent', '#ff0000');
  await expect(prefs.locator('#tok-accent')).toHaveValue('#ff0000', { timeout: 8_000 });

  await prefs.fill('#tok-radius', '10px');
  await prefs.locator('#tok-radius').blur();
  await expect.poll(async () => (await salvate(prefs)).themeTokens?.radius, { timeout: 8_000 }).toBe('10px');
  expect((await salvate(prefs)).themeTokens.accent, 'il colore chiesto a Filo resta').toBe('#ff0000');
});

test('il colore delle schede chiesto a Filo resta anche dopo aver ritoccato un numero', async ({ shell, openTab }) => {
  await daFuori(shell, 'colore_tab', 'niente colore');

  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#tabcol-opacita_tab');
  await expect(prefs.locator('#tabcol-opacita_tab')).toHaveValue('0');

  await daFuori(shell, 'colore_tab', 'più vivaci');
  await expect(prefs.locator('#tabcol-opacita_tab')).toHaveValue('0.9', { timeout: 8_000 });

  await prefs.fill('#tabcol-peso_centralita', '6');
  await prefs.locator('#tabcol-peso_centralita').blur();
  await expect.poll(async () => (await salvate(prefs)).tabColor?.peso_centralita, { timeout: 8_000 }).toBe(6);
  expect((await salvate(prefs)).tabColor.opacita_tab, 'i colori chiesti a Filo restano').toBeCloseTo(0.9, 5);
});

// Il fuoco resta sull'ultimo controllo usato, che è anche quello su cui si
// chiede a Filo di cambiare idea: se il riallineamento lo salta, la manopola
// mostra il valore vecchio e il salvataggio dopo lo rimanda indietro. Col
// volume della suoneria vuol dire di nuovo il timer muto (#667).
test('la manopola toccata per ultima segue Filo come tutte le altre', async ({ shell, openTab }) => {
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#timerRingtoneVolume');

  await prefs.locator('#timerRingtoneVolume').fill('0');
  await expect.poll(async () => (await salvate(prefs)).timerRingtoneVolume, { timeout: 8_000 }).toBe(0);

  await daFuori(shell, 'volume_suoneria', 100);
  await expect(prefs.locator('#timerRingtoneVolume')).toHaveValue('100', { timeout: 8_000 });

  await prefs.selectOption('#timerRingtone', 'chime');
  await expect.poll(async () => (await salvate(prefs)).timerRingtone, { timeout: 8_000 }).toBe('chime');
  expect((await salvate(prefs)).timerRingtoneVolume, 'il volume chiesto a Filo resta quello').toBe(100);
});
