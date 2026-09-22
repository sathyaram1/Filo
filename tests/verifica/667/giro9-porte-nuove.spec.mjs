// Verifica #667 — «il timer non suona», giro 9.
//
// I giri prima hanno dato alla suoneria un volume e la strada a parole. Qui si
// guarda il punto dove le due cose si incontrano: chiedere a parole QUALE
// motivo suona, o accendere il suono delle notifiche, mentre il volume di quel
// suono è a zero. Filo conferma, l'utente non sente niente, e per lui è di
// nuovo la segnalazione di partenza.

import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const metti = (shell, label, seconds) => shell.evaluate(
  ({ l, s }) => window.filoShell.message({ type: window.SN_MSG.MSG.FILO_ADD_TIMER, label: l, seconds: s }),
  { l: label, s: seconds },
);

const aParole = (shell, chiave, valore) => shell.evaluate(
  ({ c, v }) => window.filoShell.message({
    type: window.SN_MSG.MSG.FILO_RUN_ACTION,
    action: { type: 'IMPOSTA_PREFERENZA', chiave: c, valore: v },
  }),
  { c: chiave, v: valore },
);

const salvate = (shell) => shell.evaluate(
  () => window.filoShell.message({ type: window.SN_MSG.MSG.GET_SETTINGS }).then((r) => r.settings),
);

// Registra il picco di ogni nota programmata: senza un orecchio davanti alla
// cassa è l'unico modo di sapere se è uscito un suono.
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

// Porta 1: il motivo della suoneria chiesto a parole con il volume a zero.
// Chiedere QUALE motivo suona vuol dire volerlo sentire: se il volume è a zero
// Filo deve rimetterlo udibile (come fa già per il suono delle notifiche) o
// dirlo, non confermare un motivo che resterà muto.
test('il motivo della suoneria chiesto a parole si fa sentire davvero', async ({ shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  // L'utente aveva zittito la suoneria (manopola a zero, scelta legittima).
  await aParole(shell, 'volume_suoneria', 0);
  await expect.poll(async () => (await salvate(shell)).timerRingtoneVolume, { timeout: 8_000 }).toBe(0);

  // Poi chiede a Filo un motivo diverso: sta chiedendo di sentire quel motivo.
  const esito = await aParole(shell, 'suoneria_timer', 'delicata');
  expect(esito && esito.executed, "l'azione dev'essere eseguita").toBeTruthy();
  await expect.poll(async () => (await salvate(shell)).timerRingtone, { timeout: 8_000 }).toBe('gentle');

  await spiaVolume(shell);
  await metti(shell, 'Pasta', 3);
  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 25_000 });
  await shell.waitForTimeout(2500);

  const p = await picchi(shell);
  expect(p.filter((v) => v > 0).length, 'il motivo chiesto a parole deve uscire dalle casse').toBeGreaterThan(0);

  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
});

// Porta 2: la stessa causa sull'altro suono. Accendere a parole il suono delle
// notifiche col suo volume a zero conferma un suono che non si sentirà. La
// regola è già scritta per il MOTIVO delle notifiche (che accende anche
// l'interruttore): manca dall'altra parte.
test('il suono delle notifiche acceso a parole non resta muto per il volume a zero', async () => {
  const require = createRequire(import.meta.url);
  global.SN_CONST = { DEFAULT_SETTINGS: {} };
  require(resolve(RADICE, 'src/shared/sounds.js'));
  require(resolve(RADICE, 'src/shared/preferences.js'));
  const costruisci = global.SN_PREF.buildPreferencePartial;

  // Chi ha azzerato il volume delle notifiche e poi accende il suono si aspetta
  // di sentirlo: o il volume torna udibile, o la conferma lo dice.
  const acceso = costruisci('suono_notifiche', 'attiva');
  expect(acceso, "l'interruttore del suono delle notifiche si imposta a parole").toBeTruthy();
  const volumeRisolto = acceso.partial.notifications.soundVolume;
  const loDice = /volume|muto|zero|spento/i.test(acceso.label || '');
  expect(
    (Number.isFinite(volumeRisolto) && volumeRisolto > 0) || loDice,
    'accendere il suono a parole deve renderlo udibile, o dire che il volume è a zero',
  ).toBeTruthy();
});
