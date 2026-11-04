// #1129 — all'apertura del menu Impostazioni il main prepara nascosta la pagina della voce più scelta (all'inizio
// Preferenze): scelta, compare già caricata; chiuso il menu senza sceglierla, non resta niente di vivo. Le misure (clic
// sulla voce → pagina caricata davanti, con e senza preparazione) le stampa la prima prova.

import { test, expect } from './fixtures/electron.mjs';
import { menuAperto, scegliNelMenu } from './helpers/barra.mjs';

test.use({ envInPiu: { FILO_PREPARA_IMPOSTAZIONI: '1' } });

const PREFERENZE = 'filo://preferences/preferences.html';
const MODELLI = 'filo://options/options.html';

// Da qui in poi il main annota quando ogni pagina finisce di caricarsi, quando la scheda scelta va davanti e quante
// viste nascono.
function osserva(app) {
  return app.evaluate(({ app: a, webContents, BrowserWindow }) => {
    const o = { fine: new Map(), aperta: 0, nate: 0 };
    globalThis.__p1129 = o;
    const segui = (wc) => wc.on('did-finish-load', () => o.fine.set(wc.id, Date.now()));
    for (const wc of webContents.getAllWebContents()) segui(wc);
    a.on('web-contents-created', (_e, wc) => { o.nate++; segui(wc); });
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    const apri = tm.openTab.bind(tm);
    tm.openTab = (...args) => { const id = apri(...args); o.aperta = Date.now(); return id; };
  });
}

// La pagina preparata e le viste vive su un indirizzo, viste dal main.
function stato(app) {
  return app.evaluate(({ BrowserWindow, webContents }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    const p = tm.preparata;
    const wc = p.webContents();
    const vive = (u) => webContents.getAllWebContents().filter((x) => !x.isDestroyed() && x.getURL().startsWith(u)).length;
    return {
      preparata: wc ? { url: wc.getURL(), caricando: wc.isLoading(), visibile: p.vista.getVisible() } : null,
      preferenzeVive: vive('filo://preferences/'), modelliVive: vive('filo://options/'),
      schede: tm.tabs.map((t) => t.url),
    };
  });
}

async function apriMenu(shell, app) {
  await shell.evaluate(() => document.getElementById('nav-settings').click());
  const menu = await menuAperto(app);
  expect(menu, 'il menu Impostazioni non si è aperto').toBeTruthy();
  await expect(menu.locator('.menu')).toContainText('Preferenze');
  return menu;
}

async function chiudiMenu(app, menu) {
  await menu.keyboard.press('Escape');
  await expect.poll(async () => !!(await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w.getChildWindows().some((c) => c.isVisible() && decodeURIComponent(c.webContents.getURL()).includes('popupApi'));
  })), { timeout: 3000 }).toBe(false);
}

async function aspettaPreparata(app, url) {
  await expect.poll(async () => {
    const s = await stato(app);
    return !!(s.preparata && s.preparata.url.startsWith(url) && !s.preparata.caricando);
  }, { timeout: 15_000, message: `la pagina ${url} non è stata preparata` }).toBe(true);
}

// Clic sulla voce e tempo fino alla pagina davanti E caricata: se era già caricata, conta solo il passaggio davanti.
async function scegliEMisura(app, menu, voce, url) {
  await app.evaluate(() => { globalThis.__p1129.aperta = 0; });
  const t0 = await menu.evaluate((t) => {
    const b = [...document.querySelectorAll('button.item')].find((x) => x.textContent.includes(t));
    const ora = Date.now();
    b.click();
    return ora;
  }, voce);
  let r = null;
  await expect.poll(async () => {
    r = await app.evaluate(({ BrowserWindow }, u) => {
      const o = globalThis.__p1129;
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
      const t = tm.tabs.find((x) => x.id === tm.activeId);
      if (!t || !t.url.startsWith(u) || !o.aperta) return null;
      const wc = t.view.webContents;
      const fine = o.fine.get(wc.id);
      if (wc.isLoading() || !fine) return null;
      return { pronta: Math.max(fine, o.aperta), visibile: t.view.getVisible(), wcId: wc.id };
    }, url);
    return !!r;
  }, { timeout: 15_000, message: `la voce ${voce} non ha portato davanti ${url}` }).toBe(true);
  return { ms: r.pronta - t0, visibile: r.visibile, wcId: r.wcId };
}

async function chiudiScheda(app, url) {
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    for (const t of tm.tabs.filter((x) => x.url.startsWith(u))) tm.closeTab(t.id);
  }, url);
  await expect.poll(async () => (await stato(app)).preferenzeVive + (await stato(app)).modelliVive, { timeout: 5000 }).toBe(0);
}

const spegni = (app, spenta) => app.evaluate(({ BrowserWindow }, s) => {
  BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.preparata.spenta = s;
}, spenta);

test('Preferenze scelta dal menu compare già caricata, più in fretta che senza preparazione', async ({ app, shell }) => {
  await osserva(app);
  const misure = { senza: [], con: [] };

  // Senza preparazione: la prima apertura (a freddo) e una seconda, a cache calde.
  await spegni(app, true);
  for (let k = 0; k < 2; k++) {
    const menu = await apriMenu(shell, app);
    const m = await scegliEMisura(app, menu, 'Preferenze', PREFERENZE);
    misure.senza.push(m.ms);
    await chiudiScheda(app, PREFERENZE);
  }

  await spegni(app, false);
  for (let k = 0; k < 2; k++) {
    const menu = await apriMenu(shell, app);
    await aspettaPreparata(app, PREFERENZE);
    const prima = await stato(app);
    expect(prima.preparata.visibile, 'preparata, la pagina non si vede finché non la si sceglie').toBe(false);
    expect(prima.schede.some((u) => u.startsWith(PREFERENZE)), 'la pagina preparata non è una scheda').toBe(false);
    const preparataId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.preparata.webContents().id);
    const m = await scegliEMisura(app, menu, 'Preferenze', PREFERENZE);
    expect(m.wcId, 'la scheda è la pagina preparata, non una nuova').toBe(preparataId);
    expect(m.visibile).toBe(true);
    misure.con.push(m.ms);
    expect((await stato(app)).preferenzeVive, 'una pagina sola: quella preparata è diventata la scheda').toBe(1);
    await chiudiScheda(app, PREFERENZE);
  }

  console.log(`[#1129] clic su Preferenze → pagina caricata davanti: senza preparazione ${misure.senza.join(' / ')} ms (fredda / calda), con ${misure.con.join(' / ')} ms`);
  const con = Math.max(...misure.con);
  expect(con, 'con la preparazione la pagina è davanti subito').toBeLessThan(150);
  expect(con, 'la preparazione accorcia l\'attesa').toBeLessThan(misure.senza[1]);
});

test('la pagina preparata, scelta, è viva: risponde e salva come una scheda aperta normalmente', async ({ app, shell, openTab }) => {
  const menu = await apriMenu(shell, app);
  await aspettaPreparata(app, PREFERENZE);
  await scegliNelMenu(menu, 'Preferenze');
  await expect.poll(async () => (await stato(app)).schede.some((u) => u.startsWith(PREFERENZE)), { timeout: 5000 }).toBe(true);
  // La stessa scheda, come la trova chi la apre di nuovo: il doppione non nasce.
  const pagina = await openTab(PREFERENZE);
  await expect(pagina.locator('#theme')).toBeVisible();
  const scelto = await pagina.locator('#theme').evaluate((el) => {
    const altro = [...el.options].map((o) => o.value).find((v) => v && v !== el.value);
    el.value = altro;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return altro;
  });
  await expect.poll(() => pagina.evaluate(() => new Promise((ok) => chrome.storage.local.get('settings', (r) => ok(r && r.settings && r.settings.theme)))),
    { timeout: 5000, message: 'il tema scelto nella pagina preparata non si è salvato' }).toBe(scelto);
  expect((await stato(app)).preferenzeVive).toBe(1);
});

test('aprire e chiudere il menu senza scegliere non lascia viste vive, anche in fretta', async ({ app, shell }) => {
  await osserva(app);
  const menu = await apriMenu(shell, app);
  await aspettaPreparata(app, PREFERENZE);
  await chiudiMenu(app, menu);
  await expect.poll(async () => (await stato(app)).preferenzeVive, { timeout: 5000, message: 'la pagina preparata è rimasta viva' }).toBe(0);
  expect((await stato(app)).preparata).toBeNull();

  // Aperture a raffica: mai più di una pagina preparata, e alla fine nessuna.
  for (let k = 0; k < 5; k++) {
    await shell.evaluate(() => document.getElementById('nav-settings').click());
    expect((await stato(app)).preferenzeVive).toBeLessThanOrEqual(1);
  }
  const ultimo = await menuAperto(app);
  await chiudiMenu(app, ultimo);
  await expect.poll(async () => (await stato(app)).preferenzeVive, { timeout: 5000 }).toBe(0);
});

test('un\'apertura del menu prepara una pagina sola, e la riapertura col menu aperto la tiene', async ({ app, shell }) => {
  await osserva(app);
  await app.evaluate(() => { globalThis.__p1129.nate = 0; });
  const menu = await apriMenu(shell, app);
  await aspettaPreparata(app, PREFERENZE);
  const nate = await app.evaluate(() => globalThis.__p1129.nate);
  expect(nate, 'una sola vista nuova per apertura del menu').toBe(1);
  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.preparata.webContents().id);
  // Un secondo clic sull'ingranaggio riapre il menu: la pagina già pronta resta quella.
  await shell.evaluate(() => document.getElementById('nav-settings').click());
  await new Promise((r) => setTimeout(r, 300));
  const dopo = await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.preparata.webContents();
    return wc ? wc.id : null;
  });
  expect(dopo).toBe(id);
  await chiudiMenu(app, await menuAperto(app) || menu);
});

test('scelta un\'altra voce, la preparata si butta; la voce più scelta diventa quella che si prepara', async ({ app, shell }) => {
  for (let k = 0; k < 2; k++) {
    const menu = await apriMenu(shell, app);
    await aspettaPreparata(app, k === 0 ? PREFERENZE : PREFERENZE);
    await scegliNelMenu(menu, 'Modelli');
    await expect.poll(async () => (await stato(app)).schede.some((u) => u.startsWith(MODELLI)), { timeout: 5000 }).toBe(true);
    await expect.poll(async () => (await stato(app)).preferenzeVive, { timeout: 5000, message: 'la Preferenze non scelta è rimasta viva' }).toBe(0);
    await chiudiScheda(app, MODELLI);
  }
  // Modelli scelta due volte contro zero: è lei la voce più usata di questo utente, anche dopo il riavvio della scelta.
  const menu = await apriMenu(shell, app);
  await aspettaPreparata(app, MODELLI);
  expect((await stato(app)).preferenzeVive).toBe(0);
  await scegliNelMenu(menu, 'Modelli');
  await expect.poll(async () => (await stato(app)).schede.some((u) => u.startsWith(MODELLI)), { timeout: 5000 }).toBe(true);
  expect((await stato(app)).modelliVive).toBe(1);
  const conti = await app.evaluate(async () => (await globalThis.__filoStorage.get('filo_voci_menu_usate')).filo_voci_menu_usate);
  expect(conti.impostazioni[MODELLI]).toBe(3);
});

test('con la pagina già aperta in una scheda il menu non ne prepara un doppione', async ({ app, shell, openTab }) => {
  await openTab(PREFERENZE);
  const menu = await apriMenu(shell, app);
  await new Promise((r) => setTimeout(r, 800));
  const s = await stato(app);
  expect(s.preparata).toBeNull();
  expect(s.preferenzeVive).toBe(1);
  await chiudiMenu(app, menu);
});
