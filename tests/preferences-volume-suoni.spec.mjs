// Il volume dei suoni di Filo (#667): la suoneria di timer e sveglie e il suono
// delle notifiche hanno un motivo scelto dall'utente, e devono avere anche un
// livello. Qui si verifica che la manopola si salvi, si ritrovi e arrivi
// davvero alle note, e che a zero la suoneria resti muta.

import { test, expect } from './fixtures/electron.mjs';

const salvate = (page) => page.evaluate(async () => {
  const r = await chrome.storage.local.get('settings');
  return (r && r.settings) || {};
});

test('il volume scelto si salva, si ritrova e arriva alle note', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#timerRingtoneVolume');

  // Predefinito: pieno. Il silenzio si sceglie, non si eredita.
  await expect(page.locator('#timerRingtoneVolume')).toHaveValue('100');
  await expect(page.locator('#timerRingtoneVolumeVal')).toHaveText('100%');
  await expect(page.locator('#notifSoundVolume')).toHaveValue('100');

  await page.locator('#timerRingtoneVolume').fill('40');
  await page.locator('#timerRingtoneVolume').dispatchEvent('change');
  await expect(page.locator('#timerRingtoneVolumeVal')).toHaveText('40%');
  await expect.poll(async () => (await salvate(page)).timerRingtoneVolume, { timeout: 8_000 }).toBe(40);

  await page.locator('#notifSoundVolume').fill('0');
  await page.locator('#notifSoundVolume').dispatchEvent('change');
  await expect.poll(async () => (await salvate(page)).notifications?.soundVolume, { timeout: 8_000 }).toBe(0);

  // Riaperta la pagina, la manopola è dove l'avevi lasciata.
  const riaperta = await openTab('filo://preferences/preferences.html');
  await riaperta.waitForSelector('#timerRingtoneVolume');
  await expect(riaperta.locator('#timerRingtoneVolume')).toHaveValue('40');
  await expect(riaperta.locator('#timerRingtoneVolumeVal')).toHaveText('40%');
  await expect(riaperta.locator('#notifSoundVolume')).toHaveValue('0');

  // Il livello arriva fino alle note: a 40 il guadagno è più basso che a 100,
  // e a zero non si programma proprio niente da sentire.
  const guadagni = await riaperta.evaluate(async (v) => {
    const visti = [];
    const AC = window.AudioContext || window.webkitAudioContext;
    const creaOrig = AC.prototype.createGain;
    AC.prototype.createGain = function () {
      const g = creaOrig.call(this);
      const setOrig = g.gain.setValueAtTime.bind(g.gain);
      g.gain.setValueAtTime = (val, t) => { visti.push(val); return setOrig(val, t); };
      return g;
    };
    const misura = (vol) => {
      const da = visti.length;
      window.SN_SOUNDS.play('default', vol);
      return visti.slice(da);
    };
    const pieno = misura(100);
    const meta = misura(v);
    const muto = misura(0);
    AC.prototype.createGain = creaOrig;
    return { pieno: Math.max(0, ...pieno), meta: Math.max(0, ...meta), muteCount: muto.length };
  }, 40);
  expect(guadagni.pieno, 'a volume pieno le note hanno un livello').toBeGreaterThan(0);
  expect(guadagni.meta, 'a 40 le note sono più piano').toBeLessThan(guadagni.pieno);
  expect(guadagni.meta, 'ma si sentono ancora').toBeGreaterThan(0);
  expect(guadagni.muteCount, 'a zero non si programma nessuna nota').toBe(0);
});

test('a volume zero la scadenza resta muta, ma il pulsante che ferma c\'è', async ({ openTab, shell }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#timerRingtoneVolume');
  await page.locator('#timerRingtoneVolume').fill('0');
  await page.locator('#timerRingtoneVolume').dispatchEvent('change');
  await expect.poll(async () => (await salvate(page)).timerRingtoneVolume, { timeout: 8_000 }).toBe(0);

  const contaNote = async () => shell.evaluate(() => window.__noteViste || 0);
  await shell.evaluate(() => {
    window.__noteViste = 0;
    const AC = window.AudioContext || window.webkitAudioContext;
    const creaOrig = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function () { window.__noteViste++; return creaOrig.call(this); };
  });

  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate((t) => window.filoShell.message({ type: t, label: 'Pasta', seconds: 2 }), tipo);

  // La scadenza c'è e si vede: chi ha scelto il silenzio non perde il timer,
  // perde il rumore. Il gesto per fermare resta dov'era.
  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 15_000 });
  await shell.waitForTimeout(2000);
  expect(await contaNote(), 'a volume zero non deve partire nessuna nota').toBe(0);

  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
});
