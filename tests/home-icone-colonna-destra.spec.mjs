// #1491, #2372: Impostazioni e Profilo sono tasti di «altro» nella colonna destra; le tre colonne partono dall'alto,
// senza una fascia per le icone. Il menu di ciascuno si apre sotto il suo tasto, anche con la pagina ingrandita e
// anche dopo l'attesa che il menu dell'account fa prima di aprirsi.

import { test, expect } from './fixtures/electron.mjs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { menuAperto } from './helpers/barra.mjs';
import { homeIntera, tastoHome, TASTO } from './helpers/tastiHome.mjs';

const SHOTS = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'tests', '.shots');

async function home(app, openTab) {
  await homeIntera(app);
  const page = await openTab('filo://newtab/');
  await expect(page.locator(TASTO('impostazioni'))).toBeVisible({ timeout: 8_000 });
  return page;
}

function geometria(page) {
  return page.evaluate(() => {
    const box = (s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    return {
      icone: box('#altro'),
      destra: box('#right'),
      sinistra: box('#left'),
      centro: box('#center'),
      campo: box('#inputForm'),
      larga: document.documentElement.scrollWidth,
      vw: innerWidth,
    };
  });
}

function controllaColonne(g) {
  // I tasti stanno nella colonna destra, dentro la sua larghezza.
  expect(g.icone.left).toBeGreaterThanOrEqual(g.destra.left - 0.5);
  expect(g.icone.right).toBeLessThanOrEqual(g.destra.right + 0.5);
  // Le tre colonne cominciano alla stessa altezza: niente fascia in cima.
  expect(Math.abs(g.destra.top - g.sinistra.top)).toBeLessThanOrEqual(0.5);
  expect(g.centro.top).toBeLessThanOrEqual(g.destra.top + 0.5);
  expect(g.campo.left).toBeGreaterThanOrEqual(g.sinistra.right);
  expect(g.campo.right).toBeLessThanOrEqual(g.destra.left);
  expect(g.larga).toBeLessThanOrEqual(g.vw);
}

test('i tasti stanno nella colonna destra e le tre colonne partono dall\'alto', async ({ app, openTab }) => {
  test.setTimeout(45_000);
  const page = await home(app, openTab);
  controllaColonne(await geometria(page));
  await page.screenshot({ path: join(SHOTS, '1491-home-icone-chiaro.png') });
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.screenshot({ path: join(SHOTS, '1491-home-icone-scuro.png') });

  // Nella finestra più stretta le colonne restano, e le icone con la loro.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setSize(600, 760));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(720);
  controllaColonne(await geometria(page));
  await page.screenshot({ path: join(SHOTS, '1491-home-icone-stretta.png') });
});

// L'icona in px dello schermo: la vista della scheda davanti (la home) dentro la finestra, e il suo zoom.
async function iconaSulloSchermo(app, page, id) {
  const r = await page.evaluate((s) => {
    const b = document.querySelector(s).getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
  }, TASTO(id));
  const v = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return { vista: t.view.getBounds(), zoom: t.view.webContents.getZoomFactor(), cb: w.getContentBounds() };
  });
  const x0 = v.cb.x + v.vista.x;
  const y0 = v.cb.y + v.vista.y;
  return { top: y0 + r.top * v.zoom, bottom: y0 + r.bottom * v.zoom, left: x0 + r.left * v.zoom, right: x0 + r.right * v.zoom };
}

// Il riquadro visibile del menu (la finestra ha un margine trasparente per l'ombra), in px dello schermo.
async function menuSulloSchermo(app) {
  let finestra = null;
  await expect.poll(async () => {
    finestra = await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      const pop = BrowserWindow.getAllWindows().find((x) => x !== main && !x._filoTabs && x.isVisible() && x.getBounds().height > 60);
      return pop ? pop.getContentBounds() : null;
    });
    return Boolean(finestra);
  }, { timeout: 6_000, message: 'il menu non è comparso' }).toBe(true);
  const menu = await menuAperto(app);
  const r = await menu.evaluate(() => {
    const b = document.querySelector('.menu').getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
  });
  return { menu, top: finestra.y + r.top, bottom: finestra.y + r.bottom, left: finestra.x + r.left, right: finestra.x + r.right };
}

async function chiudiMenu(app, menu) {
  await menu.keyboard.press('Escape').catch(() => {});
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return BrowserWindow.getAllWindows().some((x) => x !== main && !x._filoTabs && x.isVisible() && x.getBounds().height > 60);
  }), { timeout: 4_000 }).toBe(false);
}

// La risposta allo stato chiesto dalla barra all'avvio, partita prima del finto, tornava dopo l'avviso e lo cancellava
// (#1273.8): la domanda fatta qui dopo il finto torna dopo quella, e l'avviso che segue resta l'ultima parola.
async function entraFinto(app, shell) {
  await app.evaluate(() => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    ga.isSignedIn = () => true;
    ga.getUid = async () => 'uid-1';
    ga.getProfile = () => ({ name: 'Mario Rossi', email: 'mario@example.it' });
    ga.isRemembered = () => true;
  });
  expect((await shell.evaluate(() => window.filoShell.auth.status())).signedIn).toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.webContents.send('filo:broadcast', {
      type: 'auth_changed', signedIn: true, profile: { name: 'Mario Rossi', email: 'mario@example.it' },
    });
  });
  await expect(shell.locator('#nav-account')).toHaveClass(/signed-in/);
}

function sottoLIcona(m, i) {
  expect(m.top, 'il menu copre l\'icona').toBeGreaterThanOrEqual(i.bottom - 1);
  expect(m.top, 'il menu si apre lontano dall\'icona').toBeLessThanOrEqual(i.bottom + 24);
  expect(m.left, 'il menu non sta sotto l\'icona').toBeLessThan(i.right);
  expect(m.right, 'il menu non sta sotto l\'icona').toBeGreaterThan(i.left);
}

test('il menu di Impostazioni e quello del profilo si aprono sotto la loro icona, anche con la home ingrandita', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  // Dentro Filo: il menu dell'account aspetta lo stato dell'accesso prima di aprirsi.
  await entraFinto(app, shell);
  const page = await home(app, openTab);
  // Senza le carte i tasti stanno in cima alla colonna, dove stavano le due icone: sotto c'è posto per il menu, che
  // altrimenti la shell apre sopra il tasto.
  // Il Profilo, rimesso in vista, in cima ai tasti come stava in cima alla colonna.
  const mosse = [...['editor', 'mazzi', 'suggerimenti', 'rapide'].map((c) => ({ tipo: 'togli', carta: c })),
    { tipo: 'aggiungi', carta: 'impostazioni', verso: 'cima' }, { tipo: 'aggiungi', carta: 'profilo', verso: 'cima' }];
  for (const m of mosse) await page.evaluate((x) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.CARTE_HOME_MODIFICA, mossa: x }), m);
  await expect(page.locator('#tieni .dash-carta')).toHaveCount(0);
  await expect(page.locator('.dash-altro-griglia.vista .dash-altro-app').first()).toHaveAttribute('data-id', 'profilo');
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId).view.webContents.setZoomFactor(1.5);
  });
  await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBeGreaterThanOrEqual(1.5);

  await (await tastoHome(page, 'impostazioni')).click();
  const impostazioni = await menuSulloSchermo(app);
  sottoLIcona(impostazioni, await iconaSulloSchermo(app, page, 'impostazioni'));
  await expect(impostazioni.menu.locator('.item').first()).toBeVisible();
  await chiudiMenu(app, impostazioni.menu);

  // Il Profilo di serie sta nel «+»: il menu si apre sotto di lui anche lì.
  await (await tastoHome(page, 'profilo')).click();
  const profilo = await menuSulloSchermo(app);
  await expect(profilo.menu.locator('.menu')).toContainText('mario@example.it');
  sottoLIcona(profilo, await iconaSulloSchermo(app, page, 'profilo'));
  await chiudiMenu(app, profilo.menu);
});
