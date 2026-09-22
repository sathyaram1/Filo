// La pagina Sicurezza e privacy aperta segue i cambiamenti fatti da fuori (#667).
// Sono protezioni che Filo fa confermare in un popup: se la pagina restasse
// ferma alla fotografia dell'apertura, mostrerebbe il contrario di com'è messo
// e al primo interruttore toccato rispegnerebbe quella appena accesa.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = 'filo://security/security.html';

// Le impostazioni di sicurezza sono di livello 2: la conferma arriva da una
// pagina interna, come quando l'utente preme OK nel popup della chat.
const confermata = (page, chiave, valore) => page.evaluate(
  ({ c, v }) => chrome.runtime.sendMessage({
    type: window.SN_MSG.MSG.FILO_CONFIRM_ACTION,
    action: { type: 'IMPOSTA_PREFERENZA', chiave: c, valore: v },
  }),
  { c: chiave, v: valore },
);

const salvate = (page) => page.evaluate(async () => {
  const r = await chrome.storage.local.get('settings');
  return ((r && r.settings) || {}).security || {};
});

test('una protezione accesa a parole si vede nella pagina aperta', async ({ openTab }) => {
  const chat = await openTab('filo://newtab/');
  await confermata(chat, 'blocco_popup', 'no');

  const sec = await openTab(PAGINA);
  await sec.waitForSelector('#sec-block-popups');
  await expect(sec.locator('#sec-block-popups')).not.toBeChecked();

  await confermata(chat, 'blocco_popup', 'sì');
  await expect(sec.locator('#sec-block-popups')).toBeChecked({ timeout: 8_000 });
});

test('toccare un interruttore non rispegne la protezione accesa a parole', async ({ openTab }) => {
  const chat = await openTab('filo://newtab/');
  await confermata(chat, 'blocco_popup', 'no');

  const sec = await openTab(PAGINA);
  await sec.waitForSelector('#sec-block-popups');
  await expect(sec.locator('#sec-block-popups')).not.toBeChecked();

  await confermata(chat, 'blocco_popup', 'sì');
  await expect(sec.locator('#sec-block-popups')).toBeChecked({ timeout: 8_000 });

  // Un interruttore che col blocco dei popup non c'entra.
  await sec.locator('#sec-adblock').click();
  await expect.poll(async () => (await salvate(sec)).adblock?.enabled, { timeout: 8_000 }).toBe(false);
  expect((await salvate(sec)).blockPopups, 'il blocco dei popup resta acceso').toBe(true);
});

test('il campo in uso non viene riscritto sotto le dita', async ({ openTab }) => {
  const chat = await openTab('filo://newtab/');
  const sec = await openTab(PAGINA);
  await sec.waitForSelector('#sec-siteblock-blacklist');

  await sec.locator('#sec-siteblock-blacklist').click();
  await sec.locator('#sec-siteblock-blacklist').fill('sto-scrivendo.example');
  await confermata(chat, 'blocco_popup', 'no');
  await sec.waitForTimeout(1200);

  await expect(sec.locator('#sec-siteblock-blacklist')).toHaveValue('sto-scrivendo.example');
});

// Stessa regola sulle protezioni: l'interruttore appena spento è quello che si
// chiede a Filo di riaccendere, e saltarlo nel riallineamento lo rispegneva al
// primo altro tocco (#667).
test('l’interruttore toccato per ultimo segue Filo come tutti gli altri', async ({ openTab }) => {
  const chat = await openTab('filo://newtab/');
  const sec = await openTab(PAGINA);
  await sec.waitForSelector('#sec-block-popups');

  await sec.locator('#sec-block-popups').click();
  await expect.poll(async () => (await salvate(sec)).blockPopups, { timeout: 8_000 }).toBe(false);

  await confermata(chat, 'blocco_popup', 'sì');
  await expect(sec.locator('#sec-block-popups')).toBeChecked({ timeout: 8_000 });

  await sec.locator('#sec-adblock').click();
  await expect.poll(async () => (await salvate(sec)).adblock?.enabled, { timeout: 8_000 }).toBe(false);
  expect((await salvate(sec)).blockPopups, 'il blocco dei popup resta acceso').toBe(true);
});
