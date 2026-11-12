// #678.6 — fuori dalla bacheca un accesso che aspetta un browser chiuso non spegne chi l'ha chiesto: il menu Profilo e la
// posta delle segnalazioni dicono che aspetta, riportano davanti la pagina (il browser al più ogni 10 secondi, #1132) o
// lasciano stare. Google finto rifiuta la scheda, così l'accesso continua nel browser di sistema, finto anche lui.

import { test, expect } from './fixtures/electron.mjs';
import { googleFinto, rispondiAlLoopback, risposteFinte } from './helpers/googleFinto.mjs';

const RIAPERTURA_MS = 10_000;

const popup = (app) => app.windows().find((w) => w.url().startsWith('data:text/html'));
async function chiudiPopup(app) {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      let u = '';
      try { u = w.webContents.getURL(); } catch (_) {}
      if (u.startsWith('data:text/html')) { try { w.destroy(); } catch (_) {} }
    }
  });
}
// Il Profilo come lo preme l'icona della home: il bottone vero della shell.
async function menuProfilo(app, shell) {
  await chiudiPopup(app);
  await shell.evaluate(() => document.getElementById('nav-account').click());
  await expect.poll(() => Boolean(popup(app))).toBe(true);
  const p = popup(app);
  await p.locator('.item').first().waitFor();
  return p;
}
const voci = (p) => p.locator('.item').allTextContents().then((t) => t.map((x) => x.trim()));
const aperture = (app) => app.evaluate(() => globalThis.__aperture.slice());

test('Profilo con l\'accesso che aspetta il browser: il menu si apre, dice che aspetta, riapre il browser e lascia stare', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  await googleFinto(app, testServer, { rifiuta: true });

  await (await menuProfilo(app, shell)).locator('.item', { hasText: 'Accedi con Google' }).click();
  await expect.poll(() => aperture(app).then((a) => a.length)).toBe(1);
  const apertoAlle = Date.now();

  // Il browser è stato chiuso senza entrare: il Profilo si apre lo stesso, con Crediti e incognito.
  let p = await menuProfilo(app, shell);
  expect(await voci(p)).toEqual([
    'Completa l\'accesso nella pagina di Google', 'Torna all\'accesso', 'Lascia stare', 'Crediti', 'Nuova finestra incognito',
  ]);
  await expect(p.locator('.item.disabled')).toHaveText('Completa l\'accesso nella pagina di Google');
  for (const tema of ['light', 'dark']) {
    await p.emulateMedia({ colorScheme: tema });
    await p.screenshot({ path: `tests/.shots/678.6-profilo-attesa-${tema}.png` });
  }

  // «Torna all'accesso» riapre la stessa pagina, ma non prima di 10 secondi dall'apertura di prima.
  await p.locator('.item', { hasText: 'Torna all\'accesso' }).click();
  await shell.waitForTimeout(500);
  expect((await aperture(app)).length, 'riaperto il browser prima di 10 secondi').toBe(1);
  await shell.waitForTimeout(Math.max(0, apertoAlle + RIAPERTURA_MS + 300 - Date.now()));
  await (await menuProfilo(app, shell)).locator('.item', { hasText: 'Torna all\'accesso' }).click();
  await expect.poll(() => aperture(app).then((a) => a.length)).toBe(2);
  const [prima, dopo] = await aperture(app);
  expect(dopo).toBe(prima);

  // «Lascia stare»: il menu torna quello di chi non è dentro, e l'esito tardivo non diventa un avviso d'errore.
  await (await menuProfilo(app, shell)).locator('.item', { hasText: 'Lascia stare' }).click();
  p = await menuProfilo(app, shell);
  expect(await voci(p)).toEqual(['Accedi con Google', 'Crediti', 'Nuova finestra incognito']);
  await chiudiPopup(app);
  expect(await rispondiAlLoopback(prima, 'error=access_denied')).toBe(200);
  await shell.waitForTimeout(800);
  await expect(shell.locator('.shell-notif-msg', { hasText: 'annullato' })).toHaveCount(0);
});

test('posta delle segnalazioni da non owner: «Accedi» col browser chiuso dice che aspetta, si riapre e si lascia stare', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await googleFinto(app, testServer, { rifiuta: true });
  const page = await openTab('filo://feedback/feedback.html');
  const banner = page.locator('#adminBanner');
  const accedi = page.locator('#adminSignIn');
  const lascia = page.locator('#adminLascia');
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(lascia).toBeHidden();

  await accedi.click();
  await expect.poll(() => aperture(app).then((a) => a.length)).toBe(1);
  await expect(page.locator('#adminBannerText')).toHaveText('Completa l\'accesso nella pagina di Google che si è aperta.');
  await expect(page.locator('#adminSpin')).toBeVisible();
  await expect(accedi).toBeEnabled();
  await expect(accedi).toHaveText('Torna all\'accesso');
  await expect(lascia).toBeVisible();
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.screenshot({ path: `tests/.shots/678.6-posta-attesa-${tema}.png` });
  }

  await lascia.click();
  await expect(lascia).toBeHidden();
  await expect(page.locator('#adminSpin')).toBeHidden();
  await expect(accedi).toHaveText('Accedi');
  await expect(page.locator('#adminBannerText')).toHaveText('I feedback li vede chi li gestisce: accedi con un account amministratore.');

  // Lasciato stare, l'esito che arriva dopo non riempie il riquadro di rosso.
  const [indirizzo] = await aperture(app);
  expect(await rispondiAlLoopback(indirizzo, 'error=access_denied')).toBe(200);
  await page.waitForTimeout(500);
  await expect(page.locator('#adminBannerText')).not.toHaveClass(/fb-admin-ko/);

  // Un accesso nuovo che non riesce dice il perché, e il pulsante torna «Accedi».
  await accedi.click();
  await expect.poll(() => aperture(app).then((a) => a.length)).toBe(2);
  const nuovo = (await aperture(app))[1];
  expect(nuovo).not.toBe(indirizzo);
  expect(await rispondiAlLoopback(nuovo, 'error=access_denied')).toBe(200);
  await expect(page.locator('#adminBannerText')).toHaveText('Accesso annullato: riprova quando vuoi.');
  await expect(accedi).toHaveText('Accedi');
  await expect(lascia).toBeHidden();
});

// #1351 giro 1 — «Lascia stare» poi di nuovo «Accedi» è un tentativo nuovo: la pagina si apre subito, anche entro i
// 10 secondi; e «Torna all'accesso» premuto troppo presto non si perde, la pagina arriva allo scadere.
test('Profilo: «Lascia stare» e di nuovo «Accedi con Google» riaprono subito; «Torna all\'accesso» troppo presto arriva dopo', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  await googleFinto(app, testServer, { rifiuta: true });
  await (await menuProfilo(app, shell)).locator('.item', { hasText: 'Accedi con Google' }).click();
  await expect.poll(() => aperture(app).then((a) => a.length)).toBe(1);
  await (await menuProfilo(app, shell)).locator('.item', { hasText: 'Lascia stare' }).click();
  await (await menuProfilo(app, shell)).locator('.item', { hasText: 'Accedi con Google' }).click();
  await expect.poll(() => aperture(app).then((a) => a.length), { timeout: 3000 }).toBe(2);
  const apertoAlle = Date.now();
  await (await menuProfilo(app, shell)).locator('.item', { hasText: 'Torna all\'accesso' }).click();
  await shell.waitForTimeout(500);
  expect((await aperture(app)).length, 'riaperto il browser prima di 10 secondi').toBe(2);
  await expect.poll(() => aperture(app).then((a) => a.length), { timeout: Math.max(1000, apertoAlle + RIAPERTURA_MS + 3000 - Date.now()) }).toBe(3);
  const [a, b, c] = await aperture(app);
  expect(b).toBe(a);
  expect(c).toBe(a);
  await chiudiPopup(app);
  expect(await rispondiAlLoopback(a, 'error=access_denied')).toBe(200);
});

// #1351 giro 1 — la posta delle segnalazioni chiude la sua attesa quando l'accesso arriva da un'altra strada.
test('posta delle segnalazioni: l\'accesso finito dal menu Profilo chiude l\'attesa del riquadro', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  await googleFinto(app, testServer, { rifiuta: true });
  await risposteFinte(app, 'utente@prova.test');
  const page = await openTab('filo://feedback/feedback.html');
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 15_000 });
  await page.locator('#adminSignIn').click();
  await expect.poll(() => aperture(app).then((a) => a.length)).toBe(1);
  await page.locator('#adminLascia').click();
  await expect(page.locator('#adminLascia')).toBeHidden();
  // Di nuovo da qui, poi l'accesso lo finisce chi l'ha chiesto dal Profilo.
  await page.locator('#adminSignIn').click();
  await expect(page.locator('#adminLascia')).toBeVisible();
  await (await menuProfilo(app, shell)).locator('.item', { hasText: 'Accedi con Google' }).click();
  await chiudiPopup(app);
  const [indirizzo] = await aperture(app);
  expect(await rispondiAlLoopback(indirizzo)).toBe(200);
  await expect(page.locator('#adminLascia')).toBeHidden();
  await expect(page.locator('#adminSpin')).toBeHidden();
  await expect(page.locator('#adminBannerText')).toHaveText('L\'account utente@prova.test non è un amministratore: i feedback li vede chi li gestisce.');
});
