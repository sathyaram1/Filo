// Verifica #667 — «il timer non suona», giro 9.
//
// I giri prima hanno dato alla suoneria un volume e la strada a parole, e hanno
// insegnato alle pagine di impostazioni a seguire i cambiamenti fatti da fuori.
// Qui si guardano i due bordi rimasti: chiedere a parole QUALE motivo suona
// mentre il volume di quel suono è a zero, e la pagina di impostazioni che la
// cura ha saltato.

import { test, expect } from '../../fixtures/electron.mjs';

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

const salvate = (page) => page.evaluate(async () => {
  const r = await chrome.storage.local.get('settings');
  return (r && r.settings) || {};
});

const salvateShell = (shell) => shell.evaluate(
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
// Filo deve rimetterlo udibile (come fa già per il motivo delle notifiche, dove
// accende l'interruttore) oppure dirlo, non confermare un motivo che resta muto.
test('il motivo della suoneria chiesto a parole si fa sentire davvero', async ({ shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  // L'utente aveva zittito la suoneria: la manopola arriva a zero, è una scelta
  // che Filo gli offre.
  await aParole(shell, 'volume_suoneria', 0);
  await expect.poll(async () => (await salvateShell(shell)).timerRingtoneVolume, { timeout: 8_000 }).toBe(0);

  // Poi chiede a Filo un motivo diverso: sta chiedendo di sentire quel motivo.
  const esito = await aParole(shell, 'suoneria_timer', 'delicata');
  expect(esito && esito.executed, "l'azione dev'essere eseguita").toBeTruthy();
  await expect.poll(async () => (await salvateShell(shell)).timerRingtone, { timeout: 8_000 }).toBe('gentle');

  await spiaVolume(shell);
  await metti(shell, 'Pasta', 3);
  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 25_000 });
  await shell.waitForTimeout(2500);

  const p = await picchi(shell);
  expect(p.filter((v) => v > 0).length, 'il motivo chiesto a parole deve uscire dalle casse').toBeGreaterThan(0);

  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
});

// Porta 2: la pagina «Altro» salva i domini esclusi come blocco intero, letto
// una volta all'apertura, e non ascolta i cambiamenti da fuori. Il ripristino
// completo delle impostazioni li azzera: la pagina continua a mostrarli e al
// primo ritocco li rimanda nello storage, disfacendo il ripristino.
test('la pagina dei domini esclusi segue il ripristino delle impostazioni', async ({ openTab }) => {
  test.setTimeout(120_000);
  const altro = await openTab('filo://options/altro.html');
  await altro.waitForSelector('#blocklist');

  await altro.locator('#blocklist').fill('esempio.test\naltro.test');
  await altro.locator('#blocklist').dispatchEvent('change');
  await expect.poll(async () => (await salvate(altro)).blocklist, { timeout: 8_000 })
    .toEqual(['esempio.test', 'altro.test']);

  // Da Preferenze, «Ripristina tutto»: riporta ogni impostazione ai predefiniti.
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#theme');
  await prefs.evaluate(() => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.RESET_SETTINGS }));
  await expect.poll(async () => (await salvate(prefs)).blocklist, { timeout: 8_000 }).toEqual([]);

  // La pagina Altro deve mostrare il ripristino, non l'elenco di prima.
  await expect(altro.locator('#blocklist'), 'i domini esclusi ripristinati spariscono anche a schermo')
    .toHaveValue('', { timeout: 8_000 });

  // E il primo ritocco su quella pagina non deve riportarli indietro.
  await altro.locator('#blocklist').fill('solo-questo.test');
  await altro.locator('#blocklist').dispatchEvent('change');
  await expect.poll(async () => (await salvate(altro)).blocklist, { timeout: 8_000 })
    .toEqual(['solo-questo.test']);
});
