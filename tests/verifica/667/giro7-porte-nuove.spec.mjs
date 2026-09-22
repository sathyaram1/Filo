// Verifica #667 — «il timer non suona», giro 7.
//
// Il giro scorso ha trovato che la pagina Preferenze aperta è una fotografia:
// al primo tocco su una manopola rimandava indietro tutto quello che era
// cambiato da fuori, volume della suoneria compreso. La cura è arrivata sul
// salvataggio principale di quella pagina. Qui si guarda se il meccanismo è
// stato curato davvero o solo il blocco che si era visto: la stessa pagina ha
// altri due salvataggi, e un'altra pagina di impostazioni non ascolta affatto.

import { test, expect } from '../../fixtures/electron.mjs';

const azione = (shell, chiave, valore) => shell.evaluate(
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

// Un'impostazione di livello 2 passa dal popup di conferma: la conferma arriva
// da una pagina interna, come quando l'utente preme OK nella chat.
const confermata = (page, chiave, valore) => page.evaluate(
  ({ c, v }) => chrome.runtime.sendMessage({
    type: window.SN_MSG.MSG.FILO_CONFIRM_ACTION,
    action: { type: 'IMPOSTA_PREFERENZA', chiave: c, valore: v },
  }),
  { c: chiave, v: valore },
);

const impostazioni = (shell) => shell.evaluate(
  () => window.filoShell.message({ type: window.SN_MSG.MSG.GET_SETTINGS }),
);

// Porta 1: il colore delle tab chiesto a parole. La pagina Preferenze lo
// governa in un blocco suo, salvato tutto insieme da una copia letta
// all'apertura: chi chiede a Filo «tab più vivaci» e poi ritocca un numero in
// quella sezione si ritrova i colori com'erano prima di chiederlo.
test('il colore delle tab chiesto a parole sopravvive a un numero ritoccato in Preferenze', async ({ shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  await azione(shell, 'colore_tab', 'niente colore');
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.locator('#tabcol-opacita_tab').scrollIntoViewIfNeeded();
  await expect(prefs.locator('#tabcol-opacita_tab')).toHaveValue('0', { timeout: 10_000 });

  const chiesto = await azione(shell, 'colore_tab', 'più vivaci');
  expect(chiesto && chiesto.executed, 'il colore delle tab si chiede a parole').toBe(true);
  expect((await impostazioni(shell)).settings.tabColor.opacita_tab).toBeCloseTo(0.9, 5);

  // Ora l'utente ritocca un ALTRO parametro della stessa sezione.
  await prefs.fill('#tabcol-peso_centralita', '6');
  await prefs.locator('#tabcol-peso_centralita').blur();
  await prefs.waitForTimeout(1500);

  const dopo = (await impostazioni(shell)).settings.tabColor;
  expect(dopo.opacita_tab, 'ritoccare un numero non deve annullare quello chiesto a parole').toBeCloseTo(0.9, 5);
});

// Porta 2: i token estetici. È la strada che la filosofia di Filo cita per
// prima («uno stile più retrò»): Filo cambia un colore su richiesta in chat.
// Anche quelli stanno in un blocco salvato da una copia letta all'apertura.
test('un colore chiesto a Filo sopravvive a un token ritoccato in Preferenze', async ({ shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  const prefs = await openTab('filo://preferences/preferences.html');
  await expect(prefs.locator('#tok-accent')).toBeVisible({ timeout: 10_000 });

  const chiesto = await estetica(shell, 'accent', '#ff0000');
  expect(chiesto && chiesto.executed, 'il colore d\'accento si chiede a Filo').toBe(true);
  expect((await impostazioni(shell)).settings.themeTokens.accent).toBe('#ff0000');

  // L'utente ritocca un token che con l'accento non c'entra.
  await prefs.fill('#tok-radius', '10px');
  await prefs.locator('#tok-radius').blur();
  await prefs.waitForTimeout(1500);

  const dopo = (await impostazioni(shell)).settings.themeTokens;
  expect(dopo.accent, 'ritoccare un altro token non deve annullare il colore chiesto a Filo').toBe('#ff0000');
});

// Porta 3: la pagina Sicurezza e privacy. Quella pagina non ascolta affatto i
// cambiamenti arrivati da fuori, e ogni suo interruttore risalva l'intero
// blocco. Qui pesa di più che altrove: sono protezioni che Filo fa confermare
// all'utente con un popup, e che poi si rispengono da sole senza dirlo.
test('una protezione accesa a parole sopravvive a un interruttore toccato in Sicurezza', async ({ shell, openTab }) => {
  test.setTimeout(150_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  // Le protezioni sono di livello 2: l'utente le conferma nel popup, e quella
  // conferma è la stessa che manda la pagina della chat.
  const chat = await openTab('filo://newtab/');
  await chat.waitForLoadState('domcontentloaded');

  await confermata(chat, 'blocco_popup', 'no');
  const sec = await openTab('filo://security/security.html');
  await expect(sec.locator('#sec-block-popups')).not.toBeChecked({ timeout: 10_000 });

  const chiesto = await confermata(chat, 'blocco_popup', 'sì');
  expect(chiesto && chiesto.executed, 'il blocco popup si accende a parole').toBe(true);
  expect((await impostazioni(shell)).settings.security.blockPopups).toBe(true);

  // L'utente tocca un altro interruttore della stessa pagina.
  await sec.locator('#sec-protect-ip').click();
  await sec.waitForTimeout(1500);

  const dopo = (await impostazioni(shell)).settings.security;
  expect(dopo.blockPopups, 'toccare un altro interruttore non deve rispegnere il blocco popup').toBe(true);
});

// Controprova della porta 3: la pagina deve anche MOSTRARE quello che è
// cambiato. Un interruttore che dice «spento» mentre la protezione è accesa
// manda l'utente a rispegnerla credendo di accenderla.
test('la pagina Sicurezza mostra la protezione accesa a parole', async ({ shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  const chat = await openTab('filo://newtab/');
  await chat.waitForLoadState('domcontentloaded');

  await confermata(chat, 'blocco_popup', 'no');
  const sec = await openTab('filo://security/security.html');
  await expect(sec.locator('#sec-block-popups')).not.toBeChecked({ timeout: 10_000 });

  await confermata(chat, 'blocco_popup', 'sì');
  await sec.waitForTimeout(1500);
  await expect(sec.locator('#sec-block-popups'), 'la pagina aperta deve seguire il cambiamento').toBeChecked();
});
