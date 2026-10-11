// Verifica #667 — «il timer non suona», giro 5.
//
// I giri prima hanno chiuso le porte che lasciavano una scadenza viva e muta.
// Il giro 4 ha chiesto in più una manopola del volume, «a voce o in
// preferenze». Qui si guarda quella manopola: che il volume scelto sia davvero
// quello che esce, che a zero la scadenza resti almeno visibile, e che la
// strada a parole esista quanto quella con le manopole.

import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const metti = (shell, label, seconds) => shell.evaluate(
  ({ l, s }) => window.filoShell.message({ type: window.SN_MSG.MSG.FILO_ADD_TIMER, label: l, seconds: s }),
  { l: label, s: seconds },
);

const impostaVolume = (shell, v) => shell.evaluate(
  (vol) => window.filoShell.message({
    type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { timerRingtoneVolume: vol },
  }),
  v,
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

async function attendi(fn, ms = 20_000) {
  const scadenza = Date.now() + ms;
  while (Date.now() < scadenza) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

// Porta 1: la manopola del volume. Una sveglia alle sei e un timer in cucina
// non vogliono lo stesso volume: se la manopola c'è ma non cambia niente,
// l'utente che l'ha abbassata si ritrova col timer di sempre, e quello che
// l'ha alzata con un timer che non sente.
test('il volume scelto è quello che esce, e cambiarlo mentre suona si sente subito', async ({ shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  await impostaVolume(shell, 40);
  await spiaVolume(shell);

  await metti(shell, 'Pasta', 3);
  const bassi = await attendi(async () => {
    const p = await picchi(shell);
    return p.length ? p : null;
  }, 25_000);
  expect(bassi, 'la scadenza deve suonare').toBeTruthy();
  const massimoBasso = Math.max(...bassi);
  expect(massimoBasso, 'a volume 40 le note devono uscire più piano del pieno')
    .toBeLessThan(0.35);
  expect(massimoBasso, 'ma non mute').toBeGreaterThan(0);

  // Alzarlo mentre suona: si deve sentire adesso, non alla scadenza dopo.
  await shell.evaluate(() => { window.__picchi = []; });
  await impostaVolume(shell, 100);
  const alti = await attendi(async () => {
    const p = await picchi(shell);
    return p.length ? p : null;
  }, 20_000);
  expect(alti, 'alzato il volume la suoneria deve riprendere a suonare').toBeTruthy();
  expect(Math.max(...alti), 'e più forte di prima').toBeGreaterThan(massimoBasso);

  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
});

// Porta 2: il volume a zero. È una scelta legittima (la manopola arriva a 0),
// ma una scadenza muta senza niente da vedere sarebbe la segnalazione di
// partenza: chi ha messo il volume a zero deve comunque accorgersi che il
// timer è scaduto, e potergli dire di smettere.
test('a volume zero la scadenza resta visibile e si ferma lo stesso', async ({ shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  await impostaVolume(shell, 0);
  await spiaVolume(shell);

  await metti(shell, 'Riso', 3);
  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 25_000 });
  await expect(shell.locator('#ring-ind-label')).toHaveText('Riso — scaduto', { timeout: 10_000 });

  await shell.waitForTimeout(2500);
  const p = await picchi(shell);
  expect(p.filter((v) => v > 0).length, 'a volume zero non deve uscire nessuna nota').toBe(0);

  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
});

// Porta 3: la strada a parole. Filo promette all'utente di scegliere motivo e
// volume «a parole o con le manopole», e in Filo tutto si deve poter chiedere
// a voce. Ma l'elenco delle impostazioni che l'assistente riceve — l'unico da
// cui gli è permesso pescare — non le contiene, e la stessa istruzione gli
// dice di rispondere che l'impostazione non esiste quando non è elencata.
test('suoneria e volume si possono chiedere a Filo, non solo con le manopole', async () => {
  const require_ = createRequire(import.meta.url);
  const g = globalThis;
  g.window = g;
  require_(resolve(RADICE, 'src/shared/actionTools.js'));
  const strumenti = g.SN_ACTION_TOOLS.TOOLS.IMPOSTA_PREFERENZA;
  const elenco = typeof strumenti.description === 'function'
    ? strumenti.description({ sistema: {} })
    : strumenti.description;

  expect(elenco, "il motivo della suoneria dev'essere fra le impostazioni che Filo sa cambiare a parole")
    .toMatch(/suoneria/i);
  expect(elenco, "il volume della suoneria dev'essere fra le impostazioni che Filo sa cambiare a parole")
    .toMatch(/volume/i);
});

// Porta 4: chiedere il volume di una cosa diversa. Le Preferenze mostrano due
// manopole del volume, la suoneria e il suono delle notifiche: se a parole
// tutte e due finiscono sulla prima, chi chiede di azzerare il volume delle
// notifiche si ritrova il timer muto, cioè la segnalazione di partenza.
test('il volume delle notifiche chiesto a parole non azzera la suoneria del timer', async () => {
  const require_ = createRequire(import.meta.url);
  const g = globalThis;
  g.window = g;
  require_(resolve(RADICE, 'src/shared/preferences.js'));
  const costruisci = g.SN_PREF.buildPreferencePartial;

  const suoneria = costruisci('volume_suoneria', 30);
  expect(suoneria && suoneria.partial.timerRingtoneVolume, 'il volume della suoneria si imposta').toBe(30);

  for (const chiave of ['volume_notifiche', 'volume delle notifiche', 'volume notifica']) {
    const r = costruisci(chiave, 0);
    const tocca = r ? Object.keys(r.partial) : [];
    expect(tocca, `«${chiave}» non deve azzerare la suoneria del timer`)
      .not.toContain('timerRingtoneVolume');
  }
});

// Porta 5: l'aspetto delle manopole nuove. Si guardano davvero, chiaro e scuro.
test('le manopole del volume si vedono in tema chiaro e in tema scuro', async ({ shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  for (const tema of ['light', 'dark']) {
    await shell.evaluate(
      (t) => window.filoShell.message({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } }),
      tema,
    );
    const page = await openTab('filo://preferences/preferences.html');
    await page.locator('#timerRingtoneVolume').scrollIntoViewIfNeeded();
    await expect(page.locator('#timerRingtoneVolume')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#timerRingtoneVolumeVal')).toHaveText(/%$/, { timeout: 5_000 });
    await page.screenshot({ path: `tests/.shots/667-giro5-volume-${tema}.png` });
  }
});
