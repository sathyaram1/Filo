// #1090 — Il menu a comparsa (tasto destro su una scheda, Impostazioni e Profilo dalla home, avvisi) nasce con la
// barra e ogni apertura riusa la stessa finestra: il clic non aspetta più un processo nuovo. Gli assert guardano quello
// che vede l'utente: il menu giusto compare presto, e la riapertura del secondo livello resta in vista.

import { test, expect } from './fixtures/electron.mjs';
import { menuAperto } from './helpers/barra.mjs';

// Il tetto chiesto dal feedback fra il clic e il menu in vista, a finestra già nata.
const SUBITO_MS = 100;

// La finestra del menu della finestra principale: figlia, col documento che parla con popupApi.
const infoMenu = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
  const m = win && win.getChildWindows().find((c) => {
    try { return !c.isDestroyed() && decodeURIComponent(c.webContents.getURL()).includes('popupApi'); } catch (_) { return false; }
  });
  return m ? { id: m.id, visibile: m.isVisible(), carica: !m.webContents.isLoading(), finestre: BrowserWindow.getAllWindows().length } : null;
});

// Da qui in poi il main annota quando il menu compare e se il suo documento si ricarica.
async function osserva(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const m = win.getChildWindows().find((c) => decodeURIComponent(c.webContents.getURL()).includes('popupApi'));
    const o = { caricamenti: 0, comparso: 0 };
    globalThis.__menu1090 = o;
    m.webContents.on('did-start-loading', () => { o.caricamenti++; });
    m.on('show', () => { o.comparso = Date.now(); });
  });
}

const azzera = (app) => app.evaluate(() => { globalThis.__menu1090.comparso = 0; });
const comparsoAlle = (app) => app.evaluate(() => globalThis.__menu1090.comparso);

async function tasto(app, keyCode) {
  await app.evaluate(({ BrowserWindow }, k) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const m = win.getChildWindows().find((c) => decodeURIComponent(c.webContents.getURL()).includes('popupApi'));
    m.webContents.sendInputEvent({ type: 'keyDown', keyCode: k });
    m.webContents.sendInputEvent({ type: 'keyUp', keyCode: k });
  }, keyCode);
}

async function chiudiConEsc(app) {
  await tasto(app, 'Escape');
  await expect.poll(async () => (await infoMenu(app)).visibile, { timeout: 3000 }).toBe(false);
  expect(await menuAperto(app, { tetto: 300 }), 'chiuso, il menu non resta pieno delle voci di prima').toBeNull();
}

// Clic nella pagina (o nella barra) e tempo fino al menu in vista, sullo stesso orologio di sistema.
async function apriEMisura(app, pagina, clic, testo, arg = null) {
  await azzera(app);
  const t0 = await pagina.evaluate(clic, arg);
  await expect.poll(() => comparsoAlle(app), { timeout: 5000 }).toBeGreaterThan(0);
  const ms = (await comparsoAlle(app)) - t0;
  const menu = await menuAperto(app);
  expect(menu, 'il menu non è comparso').toBeTruthy();
  await expect(menu.locator('.menu')).toContainText(testo);
  return { ms, ...(await infoMenu(app)) };
}

const clicSullaHome = (comando) => {
  const t = Date.now();
  document.querySelector(`#dashControls .dash-ctrl[data-command="${comando}"]`).click();
  return t;
};

const tastoDestroSullaScheda = () => {
  const el = document.querySelector('.tab.active') || document.querySelector('.tab');
  const r = el.getBoundingClientRect();
  const t = Date.now();
  el.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
  }));
  return t;
};

async function homeAperta(openTab) {
  const home = await openTab('filo://newtab/');
  await home.waitForSelector('#dashControls .dash-ctrl[data-command="settings"]', { timeout: 8000 });
  return home;
}

test('dalla home Impostazioni e Profilo compaiono subito, nella finestra nata con la barra', async ({ app, openTab }) => {
  const home = await homeAperta(openTab);
  // Prima di qualunque clic il menu c'è già: nascosto e col documento caricato.
  await expect.poll(async () => { const m = await infoMenu(app); return !!m && m.carica && !m.visibile; }, { timeout: 8000 }).toBe(true);
  const nato = await infoMenu(app);
  await osserva(app);

  const impostazioni = await apriEMisura(app, home, clicSullaHome, 'Preferenze', 'settings');
  await chiudiConEsc(app);
  const profilo = await apriEMisura(app, home, clicSullaHome, 'Nuova finestra incognito', 'account');
  // Ogni voce del Profilo ha la sua icona: «Crediti» restava senza, fuori colonna.
  const senzaIcona = await (await menuAperto(app)).evaluate(() => [...document.querySelectorAll('button.item')]
    .filter((b) => !b.querySelector('.ico svg')).map((b) => b.textContent.trim()));
  expect(senzaIcona).toEqual([]);
  await chiudiConEsc(app);
  const ancora = await apriEMisura(app, home, clicSullaHome, 'Preferenze', 'settings');
  console.log(`[#1090] dalla home: ${impostazioni.ms} ms, ${profilo.ms} ms, ${ancora.ms} ms`);

  for (const m of [impostazioni, profilo, ancora]) expect(m.id, 'ogni apertura riusa la stessa finestra').toBe(nato.id);
  expect(ancora.finestre, 'aprire un menu non crea finestre').toBe(nato.finestre);
  expect(await app.evaluate(() => globalThis.__menu1090.caricamenti), 'il documento del menu non si ricarica').toBe(0);
  expect(profilo.ms).toBeLessThan(SUBITO_MS);
  expect(ancora.ms).toBeLessThan(SUBITO_MS);

  // La voce scelta fa quello che dice: Preferenze apre la sua pagina.
  const menu = await menuAperto(app);
  await menu.evaluate(() => [...document.querySelectorAll('button.item')].find((b) => /Preferenze/.test(b.textContent)).click());
  await expect.poll(() => app.windows().some((w) => { try { return w.url().startsWith('filo://preferences/'); } catch (_) { return false; } }), { timeout: 8000 }).toBe(true);
  await expect.poll(async () => (await infoMenu(app)).visibile, { timeout: 3000 }).toBe(false);
});

test('il tasto destro su una scheda e sugli avvisi usano la stessa finestra, e il secondo compare subito', async ({ app, shell, openTab, avvisi }) => {
  await homeAperta(openTab);
  await expect.poll(async () => { const m = await infoMenu(app); return !!m && m.carica; }, { timeout: 8000 }).toBe(true);
  const nato = await infoMenu(app);
  await osserva(app);

  const primo = await apriEMisura(app, shell, tastoDestroSullaScheda, 'Duplica');
  await chiudiConEsc(app);
  const secondo = await apriEMisura(app, shell, tastoDestroSullaScheda, 'Duplica');
  await chiudiConEsc(app);
  console.log(`[#1090] tasto destro sulla scheda: ${primo.ms} ms, ${secondo.ms} ms`);
  expect(primo.id).toBe(nato.id);
  expect(secondo.id).toBe(nato.id);
  expect(secondo.ms).toBeLessThan(SUBITO_MS);

  // Il menu di un avviso: stessa finestra, le sue voci, e la scelta arriva all'avviso.
  await shell.evaluate(() => {
    window.__cartella1090 = 0;
    window.filoNotify('Scaricato: report.pdf', { durationSec: 0, actions: [{ label: 'Apri cartella', onClick: () => { window.__cartella1090++; } }] });
  });
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await azzera(app);
  await vista.locator('.shell-notif-msg').click({ button: 'right' });
  await expect.poll(() => comparsoAlle(app), { timeout: 5000 }).toBeGreaterThan(0);
  const menu = await menuAperto(app);
  await expect(menu.locator('.menu')).toContainText('Apri cartella');
  expect((await infoMenu(app)).id).toBe(nato.id);
  await menu.evaluate(() => [...document.querySelectorAll('button.item')].find((b) => /Apri cartella/.test(b.textContent)).click());
  await expect.poll(() => shell.evaluate(() => window.__cartella1090)).toBe(1);
  expect(await app.evaluate(() => globalThis.__menu1090.caricamenti)).toBe(0);
});

test('la freccia di una voce a due zone riapre il menu col secondo livello, e resta in vista', async ({ app, shell, openTab }) => {
  await homeAperta(openTab);
  // Basta un fornitore configurato perché la voce compaia: qui non si apre niente da un altro paese.
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: 'socks5://127.0.0.1:9' } }); });
  await expect.poll(async () => { const m = await infoMenu(app); return !!m && m.carica; }, { timeout: 8000 }).toBe(true);
  const nato = await infoMenu(app);
  await osserva(app);

  await apriEMisura(app, shell, tastoDestroSullaScheda, 'Apri da un altro paese');
  const menu = await menuAperto(app);
  await menu.evaluate(() => document.querySelector('.row .subarrow').click());
  await expect(menu.locator('.menu')).toContainText('Francia', { timeout: 5000 });
  await expect(menu.locator('.menu')).not.toContainText('Duplica');
  // Un blur arrivato in ritardo dalla chiusura del primo livello non deve portarsi via il secondo.
  await new Promise((r) => setTimeout(r, 500));
  const dopo = await infoMenu(app);
  expect(dopo.visibile, 'il secondo livello è sparito da solo').toBe(true);
  expect(dopo.id).toBe(nato.id);
  await chiudiConEsc(app);
});

test('chiuso e subito riaperto, il menu resta in vista e la scelta funziona', async ({ app, openTab }) => {
  const home = await homeAperta(openTab);
  await expect.poll(async () => { const m = await infoMenu(app); return !!m && m.carica; }, { timeout: 8000 }).toBe(true);
  await osserva(app);
  await apriEMisura(app, home, clicSullaHome, 'Preferenze', 'settings');
  // Esc e, nell'istante in cui la finestra si nasconde, di nuovo Impostazioni.
  const esito = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const m = win.getChildWindows().find((c) => decodeURIComponent(c.webContents.getURL()).includes('popupApi'));
    const nascosto = new Promise((r) => m.once('hide', r));
    m.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    m.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await Promise.race([nascosto, new Promise((r) => setTimeout(r, 3000))]);
    const comparso = new Promise((r) => m.once('show', r));
    win.webContents.send('shell:trigger-button', { command: 'settings' });
    await Promise.race([comparso, new Promise((r) => setTimeout(r, 3000))]);
    await new Promise((r) => setTimeout(r, 500));
    return { visibile: m.isVisible() };
  });
  expect(esito.visibile, 'riaperto subito dopo la chiusura, il menu è sparito').toBe(true);
  const menu = await menuAperto(app);
  await expect(menu.locator('.menu')).toContainText('Preferenze');
  await menu.evaluate(() => [...document.querySelectorAll('button.item')].find((b) => /Preferenze/.test(b.textContent)).click());
  await expect.poll(() => app.windows().some((w) => { try { return w.url().startsWith('filo://preferences/'); } catch (_) { return false; } }), { timeout: 8000 }).toBe(true);
});

test('il menu riusato segue il tema chiaro e scuro a ogni apertura', async ({ app, openTab }) => {
  const home = await homeAperta(openTab);
  await expect.poll(async () => { const m = await infoMenu(app); return !!m && m.carica; }, { timeout: 8000 }).toBe(true);
  await osserva(app);
  const sfondo = async () => (await menuAperto(app)).evaluate(() => getComputedStyle(document.querySelector('.menu')).backgroundColor);
  try {
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
    await apriEMisura(app, home, clicSullaHome, 'Preferenze', 'settings');
    expect(await sfondo()).toBe('rgba(30, 29, 27, 0.98)');
    await chiudiConEsc(app);
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
    await apriEMisura(app, home, clicSullaHome, 'Preferenze', 'settings');
    expect(await sfondo()).toBe('rgba(248, 246, 240, 0.98)');
    await chiudiConEsc(app);
  } finally {
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'system'; });
  }
});

test('se il processo del menu muore, il clic dopo e quello in corso lo fanno comparire lo stesso', async ({ app, openTab }) => {
  await homeAperta(openTab);
  const nuovo = async (vecchio) => { const m = await infoMenu(app); return !!m && m.id !== vecchio && m.carica; };
  const crolla = (subito) => app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const m = win.getChildWindows().find((c) => decodeURIComponent(c.webContents.getURL()).includes('popupApi'));
    process.kill(m.webContents.getOSProcessId(), 'SIGKILL');
    // Il clic arriva mentre il processo muore: l'apertura in corso non si perde.
    if (s) win.webContents.send('shell:trigger-button', { command: 'apps' });
  }, subito);

  // Morto a menu chiuso: il clic successivo lo mostra, in una finestra nuova.
  await expect.poll(async () => { const m = await infoMenu(app); return !!m && m.carica; }, { timeout: 8000 }).toBe(true);
  const primo = await infoMenu(app);
  await crolla(false);
  await expect.poll(async () => (await infoMenu(app))?.id ?? null, { timeout: 5000 }).not.toBe(primo.id);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).webContents.send('shell:trigger-button', { command: 'settings' });
  });
  await expect.poll(async () => (await infoMenu(app))?.visibile, { timeout: 8000 }).toBe(true);
  await expect((await menuAperto(app)).locator('.menu')).toContainText('Preferenze');
  await chiudiConEsc(app);

  // Morto mentre il menu sta per comparire: compare lo stesso, con le voci chieste.
  await expect.poll(() => nuovo(primo.id), { timeout: 8000 }).toBe(true);
  await crolla(true);
  await expect.poll(async () => (await infoMenu(app))?.visibile, { timeout: 8000 }).toBe(true);
  await expect((await menuAperto(app)).locator('.menu')).toContainText('Download');
  await chiudiConEsc(app);
});
