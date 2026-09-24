// Giro 10 del #667 — «il timer non suona».
//
// Due famiglie restano aperte. La prima: chiedere QUALE suono esce, o di
// accenderlo, senza che nessuno guardi il volume — Filo conferma e non si sente
// niente. La seconda: la pagina di impostazioni segue i cambiamenti fatti da
// fuori, ma non per il campo di testo che ha ancora il fuoco in una scheda
// lasciata in secondo piano, e al primo altro tocco lo rimanda indietro.

import { test, expect } from '../../fixtures/electron.mjs';

const aParole = (page, chiave, valore) => page.evaluate(
  ({ c, v }) => chrome.runtime.sendMessage({
    type: window.SN_MSG.MSG.FILO_RUN_ACTION,
    action: { type: 'IMPOSTA_PREFERENZA', chiave: c, valore: v },
  }),
  { c: chiave, v: valore },
);

const aParoleShell = (shell, chiave, valore) => shell.evaluate(
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

// ── Famiglia 1: chi chiede un suono vuole sentirlo ────────────────────────

test('il motivo delle notifiche chiesto a parole si fa sentire davvero', async ({ shell, openTab }) => {
  const chat = await openTab('filo://newtab/');

  // L'utente aveva azzerato il volume delle notifiche: è una scelta che Filo
  // offre, e la manopola ci arriva.
  await aParole(chat, 'volume_notifiche', 0);
  await expect.poll(async () => (await salvate(chat)).notifications?.soundVolume, { timeout: 8_000 }).toBe(0);

  // Poi chiede il carillon per le notifiche: sta chiedendo di sentirlo.
  const esito = await aParole(chat, 'tono_notifiche', 'carillon');
  expect(esito && esito.executed, "l'azione dev'essere eseguita").toBeTruthy();

  const s = await salvate(chat);
  const udibile = Number(s.notifications?.soundVolume) > 0;
  const loDice = /volume|zero|muto|spent/i.test(String(esito.label || esito.message || ''));
  expect(udibile || loDice, 'o il volume torna udibile, o Filo dice che è a zero').toBeTruthy();
});

test('accendere a parole il suono delle notifiche non lo lascia muto in silenzio', async ({ openTab }) => {
  const chat = await openTab('filo://newtab/');

  await aParole(chat, 'volume_notifiche', 0);
  await expect.poll(async () => (await salvate(chat)).notifications?.soundVolume, { timeout: 8_000 }).toBe(0);

  const esito = await aParole(chat, 'suono_notifiche', 'sì');
  expect(esito && esito.executed, "l'azione dev'essere eseguita").toBeTruthy();
  await expect.poll(async () => (await salvate(chat)).notifications?.soundEnabled, { timeout: 8_000 }).toBe(true);

  const s = await salvate(chat);
  const udibile = Number(s.notifications?.soundVolume) > 0;
  const loDice = /volume|zero|muto/i.test(String(esito.label || esito.message || ''));
  expect(udibile || loDice, 'accendere un suono a volume zero non promette niente di udibile').toBeTruthy();
});

test('il pulsante «Prova» del suono delle notifiche a volume zero lo dice', async ({ openTab }) => {
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#notifSoundVolume');

  await prefs.locator('#notifSoundVolume').fill('0');
  await expect.poll(async () => (await salvate(prefs)).notifications?.soundVolume, { timeout: 8_000 }).toBe(0);

  await spiaVolume(prefs);
  const primaDelClic = await prefs.evaluate(() => document.body.innerText);
  await prefs.locator('#notifSoundPreview').click();
  await prefs.waitForTimeout(600);

  const p = await picchi(prefs);
  const uscitoSuono = p.filter((v) => v > 0).length > 0;
  const dopoIlClic = await prefs.evaluate(() => document.body.innerText);
  expect(uscitoSuono || dopoIlClic !== primaDelClic,
    'premere Prova a volume zero deve dare un suono o una risposta, non il nulla').toBeTruthy();
});

// ── Famiglia 2: il campo con il fuoco in una scheda in secondo piano ──────

test('lo stile dell’assistente chiesto a parole resta, anche col suo campo lasciato col fuoco', async ({ shell, openTab }) => {
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#agentStyleText');

  // L'utente clicca nel campo dello stile, poi cambia idea e lo chiede a Filo
  // da un'altra scheda: il campo resta col fuoco, ma nessuno ci sta scrivendo.
  await prefs.locator('#agentStyleText').click();
  await aParoleShell(shell, 'stile_agente', 'Rispondi sempre in versi');
  await expect.poll(async () => (await salvate(prefs)).agentStyle, { timeout: 8_000 })
    .toBe('Rispondi sempre in versi');

  // Torna in Preferenze e cambia il tema, che con lo stile non c'entra niente.
  await prefs.selectOption('#theme', 'dark');
  await expect.poll(async () => (await salvate(prefs)).theme, { timeout: 8_000 }).toBe('dark');

  expect((await salvate(prefs)).agentStyle, 'lo stile chiesto a Filo non torna indietro')
    .toBe('Rispondi sempre in versi');
  await expect(prefs.locator('#agentStyleText'), 'e il campo mostra quello che è salvato')
    .toHaveValue('Rispondi sempre in versi');
});

test('la durata delle notifiche chiesta a parole resta, anche col suo campo lasciato col fuoco', async ({ shell, openTab }) => {
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#notifDuration');

  await prefs.locator('#notifDuration').click();
  await aParoleShell(shell, 'durata_notifiche', 30);
  await expect.poll(async () => (await salvate(prefs)).notifications?.durationSec, { timeout: 8_000 }).toBe(30);

  await prefs.selectOption('#theme', 'dark');
  await expect.poll(async () => (await salvate(prefs)).theme, { timeout: 8_000 }).toBe('dark');

  expect((await salvate(prefs)).notifications?.durationSec, 'la durata chiesta a Filo non torna indietro')
    .toBe(30);
});

test('il limite di spesa chiesto a parole resta, anche col suo campo lasciato col fuoco', async ({ shell, openTab }) => {
  const opz = await openTab('filo://options/options.html');
  await opz.waitForSelector('#monthlyLimit');

  await opz.locator('#monthlyLimit').click();
  await aParoleShell(shell, 'limite_spesa', 20);
  await expect.poll(async () => (await salvate(opz)).monthlyLimitEur, { timeout: 8_000 }).toBe(20);

  await opz.locator('#useDefaultModels').click();
  await opz.waitForTimeout(900);

  expect((await salvate(opz)).monthlyLimitEur, 'il limite chiesto a Filo non torna indietro').toBe(20);
});

// ── Aspetto: il pulsante che ferma la suoneria, nei due temi ──────────────

test('il pulsante che ferma la suoneria si guarda, chiaro e scuro', async ({ shell, openTab }) => {
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#theme');

  for (const tema of ['light', 'dark']) {
    await prefs.selectOption('#theme', tema);
    await expect.poll(async () => (await salvate(prefs)).theme, { timeout: 8_000 }).toBe(tema);
    await shell.evaluate(
      ({ l, s }) => window.filoShell.message({ type: window.SN_MSG.MSG.FILO_ADD_TIMER, label: l, seconds: s }),
      { l: 'Pasta', s: 2 },
    );
    await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 25_000 });
    await shell.screenshot({ path: `tests/.shots/667-giro10-suoneria-${tema}.png` });
    await shell.locator('#ring-indicator').click();
    await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
  }
});
