// #873 — ora, batteria, rete e Bluetooth si vedono nella home e la chat li sa dallo STATO.
//
// Il lettore vero del computer si sostituisce con uno finto dal main (`_perProve.usaLettore`): il resto è la
// strada vera, cioè il giro del main che rilegge da solo, l'annuncio alle pagine e la riga della home che si
// aggiorna senza ricaricare. L'ultima prova usa il lettore vero del contenitore Linux.
//
// Senza il lavoro: la home non ha #sistema, lo STATO non ha SISTEMA, e la chat offline dà un errore di rete
// generico.

import { test, expect } from './fixtures/electron.mjs';

async function newtab(app) {
  const scadenza = Date.now() + 10_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('la home non si è aperta');
}

// Il lettore finto legge un oggetto che la prova cambia quando vuole, come un computer a cui si stacca il cavo.
async function finto(app, lettura) {
  await app.evaluate(async (_, l) => {
    globalThis.__sistemaFinto = l;
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__sistemaFinto);
  }, lettura);
}
async function cambia(app, lettura) {
  await app.evaluate((_, l) => { globalThis.__sistemaFinto = l; }, lettura);
}

const PIENO = {
  batteria: { livello: 42, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa di Anna' },
  bluetooth: { acceso: true, dispositivi: ['Cuffie'] },
};

const voce = (page, v) => page.locator(`#sistema .dash-sis-voce[data-voce="${v}"]`);

test('la home mostra ora, batteria, rete e Bluetooth, e ognuna si aggiorna da sola entro pochi secondi', async ({ app }) => {
  await finto(app, PIENO);
  const page = await newtab(app);

  await expect(page.locator('#sistema')).toBeVisible({ timeout: 8_000 });
  const ora = await voce(page, 'ora').textContent();
  const adesso = await page.evaluate(() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return [`${p(d.getHours())}:${p(d.getMinutes())}`, `${p(d.getHours())}:${p((d.getMinutes() + 59) % 60)}`];
  });
  expect(adesso).toContain(ora.trim());

  await expect(voce(page, 'batteria')).toHaveText('42%');
  await expect(voce(page, 'batteria')).toHaveAttribute('title', 'A batteria');
  await expect(voce(page, 'rete')).toHaveText('Casa di Anna');
  await expect(voce(page, 'rete')).toHaveAttribute('title', 'Wi-Fi');
  await expect(voce(page, 'bluetooth')).toHaveText('1');
  await expect(voce(page, 'bluetooth')).toHaveAttribute('title', 'Bluetooth acceso');

  // Ogni icona ha il suo hover di una o due parole.
  for (const v of ['batteria', 'rete', 'bluetooth']) {
    const t = await voce(page, v).getAttribute('title');
    expect(t.trim().split(/\s+/).length, `hover di ${v}: «${t}»`).toBeLessThanOrEqual(2);
    await expect(voce(page, v).locator('svg')).toHaveCount(1);
  }
  await page.screenshot({ path: 'tests/.shots/873-home-sistema.png' }).catch(() => {});

  // Il caricatore: nessuno forza la lettura, la fa il giro del main.
  const giro = await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.GIRO_MS);
  await cambia(app, { ...PIENO, batteria: { livello: 43, inCarica: true, collegata: true } });
  await expect(voce(page, 'batteria')).toHaveAttribute('title', 'In carica', { timeout: giro + 3_000 });
  await expect(voce(page, 'batteria')).toHaveText('43%');

  await cambia(app, { ...PIENO, bluetooth: { acceso: false } });
  await expect(voce(page, 'bluetooth')).toHaveAttribute('title', 'Bluetooth spento', { timeout: giro + 3_000 });
  await expect(voce(page, 'bluetooth')).toHaveAttribute('data-stato', 'spento');

  await cambia(app, { ...PIENO, rete: { online: false } });
  await expect(voce(page, 'rete')).toHaveText('offline', { timeout: giro + 3_000 });
  await expect(voce(page, 'rete')).toHaveAttribute('data-stato', 'offline');
  await page.screenshot({ path: 'tests/.shots/873-home-offline.png' }).catch(() => {});

  // Torna la rete: «offline» se ne va.
  await cambia(app, PIENO);
  await expect(voce(page, 'rete')).toHaveText('Casa di Anna', { timeout: giro + 3_000 });

  // Col tema scuro la riga resta leggibile: le voci prendono i colori della home, non quelli fissi.
  await app.evaluate(async () => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } },
    { url: 'filo://preferences/preferences.html' },
  ));
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark', { timeout: 5_000 });
  const colori = await page.evaluate(() => ({
    voce: getComputedStyle(document.querySelector('.dash-sis-voce[data-voce="ora"]')).color,
    fondo: getComputedStyle(document.body).backgroundColor,
  }));
  expect(colori.voce).not.toBe(colori.fondo);
  await page.screenshot({ path: 'tests/.shots/873-home-scuro.png' }).catch(() => {});
});

test('un dato che il computer non dice non compare, e la riga resta in piedi', async ({ app }) => {
  await finto(app, { batteria: null, rete: { online: true, tipo: 'cavo' }, bluetooth: null });
  const page = await newtab(app);
  await expect(voce(page, 'rete')).toBeVisible({ timeout: 8_000 });
  await expect(voce(page, 'rete')).toHaveAttribute('title', 'Cavo');
  await expect(voce(page, 'batteria')).toBeHidden();
  await expect(voce(page, 'bluetooth')).toBeHidden();
  await expect(voce(page, 'ora')).toBeVisible();

  // Letture storte: nessuna rompe la riga.
  for (const storta of [
    { batteria: { livello: 'tanta' }, rete: { online: 'sì' }, bluetooth: { acceso: 1 } },
    { batteria: { livello: 900, inCarica: true }, rete: { online: true, tipo: 'satellite', nome: 'x' }, bluetooth: { acceso: true, dispositivi: 'Mouse' } },
    {},
  ]) {
    await app.evaluate(async (_, l) => {
      globalThis.__sistemaFinto = l;
      await globalThis.SN_SISTEMA_MAIN._perProve.leggiOra();
    }, storta);
    await expect(voce(page, 'ora')).toBeVisible();
  }
  await expect(voce(page, 'batteria')).toBeHidden();
  await expect(voce(page, 'rete')).toBeHidden();
  await expect(voce(page, 'bluetooth')).toBeHidden();
});

test('un nome di rete con dentro HTML resta testo, e uno lunghissimo non allarga la colonna', async ({ app }) => {
  const nome = '<img src=x onerror="document.body.dataset.preso=1">' + ' 🎧'.repeat(80);
  await finto(app, { ...PIENO, rete: { online: true, tipo: 'wifi', nome } });
  const page = await newtab(app);
  await expect(voce(page, 'rete')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('#sistema img')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.dataset.preso || '')).toBe('');
  const larghezze = await page.evaluate(() => ({
    riga: document.getElementById('sistema').getBoundingClientRect().width,
    colonna: document.getElementById('right').getBoundingClientRect().width,
    scroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  expect(larghezze.riga).toBeLessThanOrEqual(larghezze.colonna + 1);
  expect(larghezze.scroll).toBe(false);
});

test('la chat sa batteria, rete e Bluetooth dallo STATO, coi nomi recintati, e offline lo dice', async ({ app }) => {
  await finto(app, PIENO);
  const testo = await app.evaluate(async () => (await globalThis.SN_FILO_STATE.assemble({ creditiFreschi: true })).stateText);
  expect(testo).toContain('SISTEMA');
  expect(testo).toContain('Batteria: 42%, non collegata alla corrente.');
  expect(testo).toContain('Rete: collegato via Wi-Fi');
  expect(testo).toContain('Bluetooth: acceso, 1 dispositivo collegato');
  const busta = testo.slice(testo.indexOf('<<<NOMI_DISPOSITIVI>>>'), testo.indexOf('<<<FINE_NOMI_DISPOSITIVI>>>'));
  expect(busta).toContain('Casa di Anna');
  expect(busta).toContain('Cuffie');

  // Il messaggio della home resta in cache per ore: una batteria citata lì invecchierebbe.
  const home = await app.evaluate(async () => (await globalThis.SN_FILO_STATE.assemble({ sistema: false })).stateText);
  expect(home).not.toContain('SISTEMA');

  await cambia(app, { ...PIENO, rete: { online: false } });
  await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.leggiOra());
  const offline = await app.evaluate(async () => (await globalThis.SN_FILO_STATE.assemble({ creditiFreschi: true })).stateText);
  expect(offline).toContain('Rete: OFFLINE');
  // Un turno che fallisce perché la rete non c'è dice che il computer è offline, non «problema di rete».
  const frase = await app.evaluate(() => globalThis.SN_CHAT_ERRORS.sentence(new Error('fetch failed')));
  expect(frase).toMatch(/offline/);
  await cambia(app, PIENO);
  await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.leggiOra());
  const online = await app.evaluate(() => globalThis.SN_CHAT_ERRORS.sentence(new Error('fetch failed')));
  expect(online).not.toMatch(/offline/);
});

test('un sito non legge il nome della rete né dei dispositivi', async ({ app }) => {
  await finto(app, PIENO);
  const r = await app.evaluate(async () => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.SISTEMA_STATO },
    { tab: { url: 'http://sito-ostile.example/' }, url: 'http://sito-ostile.example/' },
  ));
  expect(r.ok).toBe(false);
  expect(r.code).toBe('forbidden');
  expect(JSON.stringify(r)).not.toContain('Casa di Anna');
});

test('tasto destro: dettagli, copia, nascondi; la voce torna dallo stesso riquadro e dalle Preferenze', async ({ app, shell }) => {
  await finto(app, PIENO);
  const page = await newtab(app);
  await expect(voce(page, 'batteria')).toBeVisible({ timeout: 8_000 });

  await voce(page, 'bluetooth').click({ button: 'right' });
  const box = page.locator('.dash-sis-box');
  await expect(box).toBeVisible();
  await expect(box.locator('.dash-sis-info')).toContainText('Collegati: Cuffie');
  await page.screenshot({ path: 'tests/.shots/873-riquadro.png' }).catch(() => {});
  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);

  await voce(page, 'batteria').click({ button: 'right' });
  await expect(box.locator('.dash-sis-info')).toContainText('Batteria al 42%');
  // Il riquadro aperto segue la lettura: il caricatore attaccato si vede anche lì.
  await cambia(app, { ...PIENO, batteria: { livello: 42, inCarica: true } });
  await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.leggiOra());
  await expect(box.locator('.dash-sis-info')).toContainText('In carica');
  await box.getByText('Nascondi la batteria', { exact: true }).click();
  await expect(voce(page, 'batteria')).toBeHidden();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).homeSistema?.batteria))
    .toBe(false);
  // Una lettura nuova non la fa ricomparire.
  await app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.leggiOra());
  await expect(voce(page, 'batteria')).toBeHidden();

  await voce(page, 'rete').click();
  await expect(box.getByText('Mostra la batteria', { exact: true })).toBeVisible();
  await box.getByText('Mostra la batteria', { exact: true }).click();
  await expect(voce(page, 'batteria')).toBeVisible();

  // Dalle Preferenze: la casella toglie l'ora dalla home aperta, senza ricaricarla.
  await shell.evaluate(() => window.filoShell.tabs.open('filo://preferences/preferences.html'));
  let prefPage = null;
  for (let i = 0; i < 100 && !prefPage; i++) {
    prefPage = app.windows().find((w) => w.url().startsWith('filo://preferences/'));
    if (!prefPage) await new Promise((r) => setTimeout(r, 100));
  }
  expect(prefPage, 'la pagina Preferenze non si è aperta').toBeTruthy();
  await prefPage.waitForLoadState('domcontentloaded');
  await expect(prefPage.locator('#homeSisOra')).toBeChecked({ timeout: 8_000 });
  await expect(prefPage.locator('#homeSisBatteria')).toBeChecked();
  await prefPage.locator('#homeSisOra').uncheck();
  await expect(voce(page, 'ora')).toBeHidden({ timeout: 5_000 });
  await prefPage.locator('#homeSisOra').check();
  await expect(voce(page, 'ora')).toBeVisible({ timeout: 5_000 });
});

test('a parole: «togli il Bluetooth dalla home» lo toglie dalla home aperta, e lo rimette', async ({ app }) => {
  await finto(app, PIENO);
  const page = await newtab(app);
  await expect(voce(page, 'bluetooth')).toBeVisible({ timeout: 8_000 });
  const esegui = (action) => app.evaluate(({ BrowserWindow }, a) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return globalThis.SN_EXECUTE_FILO_ACTION(a, { sender: { win, wc: win.webContents, url: 'filo://newtab/' } });
  }, action);
  const via = await esegui({ type: 'IMPOSTA_PREFERENZA', chiave: 'bluetooth_home', valore: false });
  expect(via.executed).toBe(true);
  await expect(voce(page, 'bluetooth')).toBeHidden({ timeout: 5_000 });
  const torna = await esegui({ type: 'IMPOSTA_PREFERENZA', chiave: 'bluetooth_home', valore: true });
  expect(torna.executed).toBe(true);
  await expect(voce(page, 'bluetooth')).toBeVisible({ timeout: 5_000 });
});

test('trascinata nella chat, una voce porta la sua frase', async ({ app }) => {
  await finto(app, PIENO);
  const page = await newtab(app);
  await expect(voce(page, 'batteria')).toBeVisible({ timeout: 8_000 });
  await voce(page, 'batteria').dragTo(page.locator('#input'));
  await expect(page.locator('#input')).toHaveValue('Batteria al 42%, non collegata alla corrente');
  // Accanto al campo, sul bordo del modulo: la frase va in coda a quello che c'era.
  await voce(page, 'rete').dragTo(page.locator('#sendBtn'));
  await expect(page.locator('#input')).toHaveValue('Batteria al 42%, non collegata alla corrente Collegato al Wi-Fi «Casa di Anna»');
});

test('il lettore vero di Linux: quello che il contenitore non ha non compare', async ({ app }) => {
  test.skip(process.platform !== 'linux', 'il lettore di Windows e quello del Mac si provano nelle unit');
  const page = await newtab(app);
  await expect(voce(page, 'ora')).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => app.evaluate(() => globalThis.SN_SISTEMA_MAIN.stato()), { timeout: 8_000 }).not.toBeNull();
  const letto = await app.evaluate(() => globalThis.SN_SISTEMA_MAIN.stato());
  for (const v of ['batteria', 'rete', 'bluetooth']) {
    if (letto[v]) await expect(voce(page, v)).toBeVisible();
    else await expect(voce(page, v)).toBeHidden();
  }
});
