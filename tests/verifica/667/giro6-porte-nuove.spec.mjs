// Verifica #667 — «il timer non suona», giro 6.
//
// I giri prima hanno chiuso le porte che lasciavano una scadenza viva e muta,
// e il giro 5 ha chiesto la strada a parole per motivo e volume. Qui si guarda
// quella strada percorsa davvero (non l'elenco che il modello riceve, ma
// l'azione eseguita), e le due porte che restano su quel percorso: una
// richiesta a parole che la pagina Preferenze aperta accanto rimanda indietro,
// e un tono delle notifiche scelto mentre il suono è spento.

import { test, expect } from '../../fixtures/electron.mjs';

const azione = (shell, chiave, valore) => shell.evaluate(
  ({ c, v }) => window.filoShell.message({
    type: window.SN_MSG.MSG.FILO_RUN_ACTION,
    action: { type: 'IMPOSTA_PREFERENZA', chiave: c, valore: v },
  }),
  { c: chiave, v: valore },
);

const impostazioni = (shell) => shell.evaluate(
  () => window.filoShell.message({ type: window.SN_MSG.MSG.GET_SETTINGS }),
);

const metti = (shell, label, seconds) => shell.evaluate(
  ({ l, s }) => window.filoShell.message({ type: window.SN_MSG.MSG.FILO_ADD_TIMER, label: l, seconds: s }),
  { l: label, s: seconds },
);

// Registra il picco di ogni nota programmata: è l'unico modo di misurare
// «quanto forte» senza un orecchio davanti alla cassa.
const spiaVolume = (page) => page.evaluate(() => {
  window.__picchi = [];
  const AC = window.AudioContext || window.webkitAudioContext;
  const orig = AC.prototype.createGain;
  AC.prototype.createGain = function () {
    const g = orig.call(this);
    const set = g.gain.setValueAtTime.bind(g.gain);
    g.gain.setValueAtTime = (v, t) => { window.__picchi.push(v); return set(v, t); };
    return g;
  };
});

const picchi = (page) => page.evaluate(() => (window.__picchi || []).slice());

// Porta 1: la richiesta a parole percorsa fino in fondo. Il giro scorso ha
// guardato l'elenco consegnato al modello; qui si esegue l'azione e si
// ascolta, perché una chiave dichiarata e non applicata suona uguale a una
// chiave mancante.
test('il motivo e il volume chiesti a parole arrivano davvero alla suoneria', async ({ shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  const r1 = await azione(shell, 'suoneria_timer', 'delicata');
  expect(r1 && r1.executed, 'chiedere la suoneria delicata deve eseguire').toBe(true);
  const r2 = await azione(shell, 'volume_suoneria', 40);
  expect(r2 && r2.executed, 'chiedere il volume della suoneria deve eseguire').toBe(true);

  const s = await impostazioni(shell);
  expect(s.settings.timerRingtone, 'il motivo chiesto a parole è quello salvato').toBe('gentle');
  expect(s.settings.timerRingtoneVolume, 'il volume chiesto a parole è quello salvato').toBe(40);

  await spiaVolume(shell);
  await metti(shell, 'Pasta', 3);
  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 25_000 });
  await shell.waitForTimeout(1500);
  const bassi = await picchi(shell);
  expect(bassi.length, 'a volume 40 la suoneria esce comunque').toBeGreaterThan(0);
  const max40 = Math.max(...bassi);

  await shell.evaluate(() => { window.__picchi = []; });
  const r3 = await azione(shell, 'volume_suoneria', 100);
  expect(r3 && r3.executed).toBe(true);
  await shell.waitForTimeout(1500);
  const alti = await picchi(shell);
  expect(alti.length, 'alzare il volume a parole mentre suona si sente subito').toBeGreaterThan(0);
  expect(Math.max(...alti), 'a 100 le note escono più forte che a 40').toBeGreaterThan(max40);

  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
});

// Porta 2: la pagina Preferenze aperta accanto. Filo invita l'utente a
// chiedere il volume a parole, ma la pagina non si accorge del cambiamento:
// resta ferma su quello che aveva letto all'apertura, e al primo tocco su una
// qualunque delle sue manopole riscrive TUTTE le impostazioni con i valori
// vecchi. Il volume appena alzato a parole torna dov'era, in silenzio.
test('il volume chiesto a parole sopravvive a una manopola toccata in Preferenze', async ({ shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  // L'utente parte dal silenzio: è il caso della segnalazione.
  await azione(shell, 'volume_suoneria', 0);

  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.locator('#timerRingtoneVolume').scrollIntoViewIfNeeded();
  await expect(prefs.locator('#timerRingtoneVolumeVal')).toHaveText('0%', { timeout: 10_000 });

  // Chiede a Filo, come la nota della versione gli suggerisce.
  await azione(shell, 'volume_suoneria', 100);
  expect((await impostazioni(shell)).settings.timerRingtoneVolume).toBe(100);

  // Poi torna in Preferenze e cambia una cosa che con la suoneria non c'entra.
  await prefs.selectOption('#theme', 'dark');
  await prefs.waitForTimeout(1500);

  const dopo = (await impostazioni(shell)).settings.timerRingtoneVolume;
  expect(dopo, 'toccare un\'altra manopola non deve rimettere muta la suoneria').toBe(100);
});

// Porta 3: il tono delle notifiche chiesto a parole. Il suono delle notifiche
// nasce spento: scegliere il motivo senza accendere l'interruttore lascia
// l'utente con una conferma («Tono delle notifiche → Carillon») e nessun
// suono, cioè la stessa delusione della segnalazione, sull'altro suono di Filo.
test('scegliere a parole il tono delle notifiche lo rende anche udibile', async ({ shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  const partenza = await impostazioni(shell);
  expect(partenza.settings.notifications.soundEnabled, 'il suono delle notifiche nasce spento').toBe(false);

  const r = await azione(shell, 'tono_notifiche', 'carillon');
  expect(r && r.executed, 'il tono delle notifiche si chiede a parole').toBe(true);

  const dopo = (await impostazioni(shell)).settings.notifications;
  expect(dopo.sound, 'il motivo chiesto è quello salvato').toBe('chime');
  expect(dopo.soundEnabled, 'chiedere un motivo per le notifiche deve anche farle suonare').toBe(true);
});
