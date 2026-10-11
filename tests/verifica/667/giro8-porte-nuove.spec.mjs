// Giro 8 del #667. La pagina di impostazioni aperta adesso segue i cambiamenti
// fatti da fuori, TRANNE il controllo che ha il fuoco: e il controllo che ha il
// fuoco è proprio quello che l'utente ha appena usato, cioè quello su cui poi
// chiede a Filo di cambiare idea. Lì il valore vecchio resta a vista e al primo
// altro tocco torna nello storage: col volume della suoneria è di nuovo il
// timer muto della segnalazione.

import { test, expect } from './../../fixtures/electron.mjs';

const daFuori = (shell, chiave, valore) => shell.evaluate(
  ({ c, v }) => window.filoShell.message({
    type: window.SN_MSG.MSG.FILO_RUN_ACTION,
    action: { type: 'IMPOSTA_PREFERENZA', chiave: c, valore: v },
  }),
  { c: chiave, v: valore },
);

const estetica = (shell, token, valore) => shell.evaluate(
  ({ t, v }) => window.filoShell.message({
    type: window.SN_MSG.MSG.FILO_RUN_ACTION,
    action: { type: 'IMPOSTA_ESTETICA', token: t, valore: v },
  }),
  { t: token, v: valore },
);

const salvate = (page) => page.evaluate(async () => {
  const r = await chrome.storage.local.get('settings');
  return (r && r.settings) || {};
});

test('il volume rialzato a parole resta, anche se la manopola del volume è l’ultima che l’utente ha toccato', async ({ shell, openTab }) => {
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#timerRingtoneVolume');

  // L'utente abbassa il volume con le sue mani: da quel gesto in poi la
  // manopola ha il fuoco, come qualunque controllo appena usato.
  await prefs.locator('#timerRingtoneVolume').fill('0');
  await expect.poll(async () => (await salvate(prefs)).timerRingtoneVolume, { timeout: 8_000 }).toBe(0);

  // Poi chiede a Filo di rialzarlo: è la strada che la nota della versione
  // suggerisce a chi ha il timer muto.
  await daFuori(shell, 'volume_suoneria', 100);
  await expect.poll(async () => (await salvate(prefs)).timerRingtoneVolume, { timeout: 8_000 }).toBe(100);

  // Torna in Preferenze e cambia il motivo della suoneria.
  await prefs.selectOption('#timerRingtone', 'chime');
  await expect.poll(async () => (await salvate(prefs)).timerRingtone, { timeout: 8_000 }).toBe('chime');
  expect((await salvate(prefs)).timerRingtoneVolume, 'il volume chiesto a Filo resta quello').toBe(100);
  await expect(prefs.locator('#timerRingtoneVolume'), 'e la manopola mostra il volume vero').toHaveValue('100');
});

test('una protezione riaccesa a parole non si rispegne, nemmeno se è l’interruttore toccato per ultimo', async ({ openTab }) => {
  const chat = await openTab('filo://newtab/');
  const confermata = (page, chiave, valore) => page.evaluate(
    ({ c, v }) => chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.FILO_CONFIRM_ACTION,
      action: { type: 'IMPOSTA_PREFERENZA', chiave: c, valore: v },
    }),
    { c: chiave, v: valore },
  );

  const sec = await openTab('filo://security/security.html');
  await sec.waitForSelector('#sec-block-popups');

  // L'utente spegne il blocco dei popup a mano: l'interruttore ha il fuoco.
  await sec.locator('#sec-block-popups').click();
  await expect.poll(async () => (await salvate(sec)).security?.blockPopups, { timeout: 8_000 }).toBe(false);

  // Ci ripensa e lo chiede a Filo, che glielo fa confermare.
  await confermata(chat, 'blocco_popup', 'sì');
  await expect.poll(async () => (await salvate(sec)).security?.blockPopups, { timeout: 8_000 }).toBe(true);

  // Poi tocca un interruttore che col blocco dei popup non c'entra.
  await sec.locator('#sec-adblock').click();
  await expect.poll(async () => (await salvate(sec)).security?.adblock?.enabled, { timeout: 8_000 }).toBe(false);
  expect((await salvate(sec)).security.blockPopups, 'il blocco dei popup resta acceso').toBe(true);
  await expect(sec.locator('#sec-block-popups'), 'e la pagina mostra la protezione accesa').toBeChecked();
});

test('il box per raffinare un colore non rimanda indietro gli altri colori cambiati nel frattempo', async ({ shell, openTab }) => {
  const chat = await openTab('filo://newtab/');
  await chat.waitForSelector('#input');

  // Filo risponde con una modifica estetica: nella bolla compare il bottone che
  // apre il box per scegliere la tonalità esatta.
  await chat.evaluate(() => {
    const { MSG } = window.SN_MSG;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, cb) => {
      if (msg && msg.type === MSG.FILO_CHAT) {
        cb && cb({
          ok: true,
          text: 'Fatto, ho reso i bottoni verdi.',
          actions: [{ type: 'IMPOSTA_ESTETICA', token: 'button.bg', valore: '#3a7d44' }],
        });
        return;
      }
      return orig(msg, cb);
    };
  });
  await chat.locator('#input').fill('rendi i bottoni verdi');
  await chat.locator('#sendBtn').click();
  await chat.locator('.sn-refine-trigger').click();
  await expect(chat.locator('.sn-refine-overlay')).toBeVisible({ timeout: 8_000 });

  // Col box aperto, un altro colore cambia da fuori (l'altra scheda, Filo).
  await estetica(shell, 'accent', '#ff0000');
  await expect.poll(async () => (await salvate(chat)).themeTokens?.accent, { timeout: 8_000 }).toBe('#ff0000');

  // L'utente sceglie la tonalità esatta nel box.
  await chat.evaluate(() => {
    const inp = document.querySelector('.sn-refine-color');
    inp.value = '#112233';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => (await salvate(chat)).themeTokens?.['button.bg'], { timeout: 8_000 }).toBe('#112233');
  expect((await salvate(chat)).themeTokens.accent, 'il colore d’accento cambiato nel frattempo resta').toBe('#ff0000');
});
