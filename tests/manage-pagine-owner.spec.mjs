// #1414: le pagine dell'owner hanno un ingresso solo, Gestione. Modelli predefiniti è Impostazioni predefinite, Inviti e
// utenti è Utenti; dal menu Impostazioni la voce è sparita, i vecchi indirizzi portano alla sezione, e per chi non è
// owner i menu restano quelli di prima. Le prove del lavoro dentro le due schede stanno negli spec delle pagine
// (admin-defaults-*, wallet-owner-*), che da qui in poi le aprono in Gestione.

import { mkdirSync } from 'node:fs';
import { test, expect } from './fixtures/electron.mjs';
import { paginaDellaScheda } from './helpers/schede.mjs';
import { GESTIONE, apriScheda, ricaricaSu } from './helpers/gestione.mjs';

const SHOTS = 'tests/.shots';
const IMPOSTAZIONI_DI_TUTTI = ['Modelli', 'Altro', 'Sicurezza', 'Trasparenza', 'Novità', 'Preferenze'];
const APP_DI_TUTTI = ['Editor', 'Deck builder MTG', 'Aperti per dopo', 'Download', 'Memorie', 'Bacheca'];

const popupAperti = (app) => app.windows().filter((w) => { try { return !w.isClosed() && w.url().startsWith('data:text/html'); } catch (_) { return false; } });

async function vociDelMenu(app, shell, bottone) {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      try { if (w.webContents.getURL().startsWith('data:text/html')) w.destroy(); } catch (_) {}
    }
  });
  await expect.poll(() => popupAperti(app).length).toBe(0);
  await shell.evaluate((id) => document.getElementById(id).click(), bottone);
  await expect.poll(() => popupAperti(app).length, { message: `il menu di ${bottone} non si è aperto` }).toBe(1);
  const popup = popupAperti(app)[0];
  await popup.waitForSelector('.item .lbl');
  return popup.locator('.item .lbl').allInnerTexts();
}

// Solo la shell crede di avere davanti l'owner: basta a decidere le voci dei menu, che è quello che si guarda qui.
async function shellDaOwner(app, owner) {
  await app.evaluate(({ BrowserWindow }, o) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('filo:broadcast', { type: 'auth_changed', profile: o ? { name: 'Owner', email: 'owner@prova.test' } : null, isAdmin: o });
    }
  }, owner);
}

async function apriIndirizzo(app, shell, url) {
  const aperta = await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  expect(aperta && aperta.id, `nessuna scheda per ${url}`).toBeTruthy();
  let page = null;
  await expect.poll(async () => Boolean(page = await paginaDellaScheda(app, aperta.id, (w) => w.url().startsWith(GESTIONE))),
    { message: `${url} non è arrivato in Gestione`, timeout: 15_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

test('da owner il menu Impostazioni non ha più Modelli predefiniti e il menu App porta a Gestione; per gli altri i menu sono quelli di prima', async ({ app, shell }) => {
  expect(await vociDelMenu(app, shell, 'nav-settings')).toEqual(IMPOSTAZIONI_DI_TUTTI);
  expect(await vociDelMenu(app, shell, 'nav-apps')).toEqual(APP_DI_TUTTI);

  await shellDaOwner(app, true);
  expect(await vociDelMenu(app, shell, 'nav-settings')).toEqual(IMPOSTAZIONI_DI_TUTTI);
  const appOwner = await vociDelMenu(app, shell, 'nav-apps');
  expect(appOwner.slice(0, APP_DI_TUTTI.length)).toEqual(APP_DI_TUTTI);
  expect(appOwner).toContain('Gestione');
  for (const fuori of ['Modelli predefiniti', 'Inviti e utenti']) expect(appOwner).not.toContain(fuori);

  // Tornato utente comune, tutto come prima.
  await shellDaOwner(app, false);
  expect(await vociDelMenu(app, shell, 'nav-settings')).toEqual(IMPOSTAZIONI_DI_TUTTI);
  expect(await vociDelMenu(app, shell, 'nav-apps')).toEqual(APP_DI_TUTTI);
});

test('i vecchi indirizzi di Modelli predefiniti e di Inviti e utenti aprono Gestione sulla sezione giusta', async ({ app, shell }) => {
  const casi = [
    { url: 'filo://admin-defaults/admin-defaults.html', sezione: 'predefinite', tab: 'predefiniti', porta: '#sec-denied' },
    { url: 'filo://credits/owner.html', sezione: 'utenti', tab: 'utenti', porta: '#ownerDenied' },
  ];
  for (const c of casi) {
    const page = await apriIndirizzo(app, shell, c.url);
    await expect(page.locator(`.mg-sezione--active[data-sezione="${c.sezione}"]`), c.url).toBeVisible();
    await expect(page.locator(`.mg-tab--active[data-tab="${c.tab}"]`), c.url).toBeVisible();
    await expect(page.locator(`#panel-${c.tab}`), c.url).toBeVisible();
    // La scheda ha risposto davvero: a chi non è owner dice che è dell'owner, invece di restare vuota.
    await expect(page.locator(c.porta), c.url).toBeVisible({ timeout: 10_000 });
    // L'indirizzo torna pulito: ricaricando, Gestione si riapre con la sua regola e non su un indirizzo vecchio.
    await expect.poll(() => page.url()).toBe(GESTIONE);
  }
  // Anche un indirizzo che nomina la sezione dentro Gestione già aperta ci porta.
  const page = await apriIndirizzo(app, shell, GESTIONE);
  await page.evaluate(() => { location.hash = '#utenti'; });
  await expect(page.locator('.mg-tab--active[data-tab="utenti"]')).toBeVisible();
});

test('il rimando della pagina Crediti porta a Utenti, in Gestione', async ({ openTab }) => {
  const crediti = await openTab('filo://credits/credits.html');
  const link = crediti.locator('#ownerLink a');
  await expect(link).toHaveAttribute('href', `${GESTIONE}#utenti`);
  // Il rimando lo vede solo l'owner: qui lo si scopre a mano, quello che conta è dove porta.
  await crediti.evaluate(() => { document.getElementById('ownerLink').hidden = false; });
  await link.click();
  await crediti.waitForURL(GESTIONE);
  await expect(crediti.locator('.mg-tab--active[data-tab="utenti"]')).toBeVisible();
  await expect(crediti.locator('#ownerDenied')).toBeVisible({ timeout: 10_000 });
});

// Le risposte del main per un owner, finte: la scheda si prova come la vede lui, e si registra cosa chiede.
function mainDaOwner({ config }) {
  window.__sent = [];
  const overview = {
    config: { invitesRemaining: 9, entryCredits: 5000, dailyCredits: 100, eurUsd: 1.2, eurUsdAt: '2026-10-10', maxGrantUsd: 50 },
    totals: { users: 2, totalLimitUsd: 4.2, maxGrantUsd: 50 },
    ownerInvites: [],
    users: [
      { pseudonym: 'abcdef0123456789', balance: { credits: 4000, creditsGranted: 5000, usageUsd: 0.3 }, invitedBy: 'owner', createdAt: '2026-10-01T08:00:00.000Z', usage: { rows: 3 } },
      { pseudonym: '0123456789abcdef', balance: { credits: 5000, creditsGranted: 5000, usageUsd: 0 }, invitedBy: 'owner', createdAt: '2026-10-02T08:00:00.000Z', usage: { rows: 0 } },
    ],
  };
  const stub = async (msg) => {
    window.__sent.push(msg);
    switch (msg.type) {
      case 'wallet_state': return { ok: true, isOwner: true, hasWallet: false };
      case 'wallet_owner_overview': return { ok: true, overview };
      case 'defaults_get': return { ok: true, config };
      case 'defaults_update': return { ok: true, config: { ...config, ...(msg.config || {}) } };
      case 'default_models_list': return { ok: true, provider: 'openrouter', items: [] };
      case 'default_providers_list': return { ok: true, items: [] };
      default: return { ok: true };
    }
  };
  if (window.chrome && window.chrome.runtime) window.chrome.runtime.sendMessage = stub;
  else window.chrome = { runtime: { sendMessage: stub } };
}

const CONFIG = {
  apiKeysPresent: { openrouter: true },
  modelRegistry: { esistente: { provider: 'openrouter', model: 'vendor/gia-salvato' } },
  models: { explain: 'esistente' },
  excludedProviders: [],
};

test('in Gestione le due schede funzionano come le pagine di prima: i numeri si leggono e un modello predefinito si salva', async ({ openTab }) => {
  const page = await openTab(GESTIONE);
  await page.addInitScript(mainDaOwner, { config: CONFIG });
  await ricaricaSu(page, 'utenti');
  const utenti = page.locator('#ownerNumeri .sn-wallet-numero').first();
  await expect(page.locator('#ownerSection')).toBeVisible({ timeout: 10_000 });
  await expect(utenti).toContainText('2');
  await expect(utenti).toContainText('utenti');
  await expect(page.locator('#ownerUsers tbody tr.sn-wallet-user')).toHaveCount(2);

  await apriScheda(page, 'predefiniti');
  await expect(page.locator('#editor')).toBeVisible({ timeout: 10_000 });
  // Il titolo della scheda resta «Gestione»: la scheda spostata non lo riscrive.
  expect(await page.title()).toBe('Filo — Gestione');

  // Il menu delle catene propone i soprannomi di questa pagina, non quelli dei Modelli di supporto che stanno accanto.
  await page.evaluate(() => {
    const dl = document.getElementById('nicknames-list');
    const o = document.createElement('option');
    o.value = 'solo-dei-giudici';
    dl.appendChild(o);
  });
  const cella = page.locator('#modelsGrid > div').filter({ has: page.locator('.sn-chain-input') }).first();
  const campo = cella.locator('.sn-chain-input').first();
  await campo.click();
  await campo.fill('');
  const pop = cella.locator('.sn-chain-pop');
  await expect(pop.locator('.sn-select-option', { hasText: 'esistente' })).toBeVisible();
  await expect(pop.locator('.sn-select-option', { hasText: 'solo-dei-giudici' })).toHaveCount(0);
  await campo.press('Escape');

  // Una modifica a un modello predefinito parte col salvataggio.
  const riga = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').first();
  await riga.locator('.sn-model-id').fill('vendor/nuovo-modello');
  await page.click('#saveBtn');
  await expect.poll(() => page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').length)).toBe(1);
  const upd = await page.evaluate(() => window.__sent.find((m) => m.type === 'defaults_update'));
  expect(upd.config.modelRegistry.esistente.model).toBe('vendor/nuovo-modello');
  await expect(page.locator('#saveStatus')).not.toBeEmpty();
  await expect(page.locator('#saveStatus')).not.toHaveClass(/sn-error/);

  // La barra delle sezioni, chiaro e scuro.
  mkdirSync(SHOTS, { recursive: true });
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => window.SN_PAGE_BOOTSTRAP.applyTheme(t), tema);
    for (const tab of ['predefiniti', 'utenti']) {
      await apriScheda(page, tab);
      await page.screenshot({ path: `${SHOTS}/manage-pagine-owner-${tab}-${tema}.png` });
    }
  }
});
