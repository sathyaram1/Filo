// #871 porta le icone che stavano in alto a destra nella home nella barra laterale; in alto a destra
// restano Impostazioni e Profilo, dove ogni app li mette. Gli assert verificano il SUCCESSO: le voci
// stanno nella barra, il profilo mostra l'avatar e App apre davvero il menu nativo accanto alla barra.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, comandaBarra, menuAperto, pannelloFermo } from './helpers/barra.mjs';

test('In alto a destra nella home restano Impostazioni e Profilo; le altre voci stanno nella barra laterale', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForSelector('#dashControls .dash-ctrl', { timeout: 8_000 });
  const commands = await page.$$eval('#dashControls .dash-ctrl', (els) => els.map((e) => e.dataset.command));
  expect(commands).toEqual(['settings', 'account']);
  expect(await page.$$eval('#dashControls .dash-ctrl svg', (els) => els.length)).toBe(2);
  const barra = await barraPage(app);
  const nav = await barra.$$eval('#nav .ico', (els) => els.map((e) => e.dataset.id));
  expect(nav).toContain('home');
  // Il Red Team in pausa (#896) non c'è per chi non è owner (lo prova redteam-pausa.spec.mjs).
  const fisse = await barra.$$eval('#fisse .ico:not([hidden])', (els) => els.map((e) => e.dataset.comando));
  expect(fisse).toEqual(['history', 'apps', 'account', 'settings']);
  // Ogni voce ha il suo disegno, non una lettera di ripiego.
  expect(await barra.$$eval('#nav .ico svg, #fisse .ico:not([hidden]) svg', (els) => els.length)).toBe(nav.length + fisse.length);
});

test('La barra in alto di Filo è sparita (chrome compatto, barra indirizzi nascosta)', async ({ shell, openTab }) => {
  // Apri la home così la shell renderizza e applica lo stato chrome.
  await openTab('filo://newtab/');
  await expect
    .poll(() => shell.evaluate(() => document.documentElement.dataset.chromeCompact), { timeout: 5_000 })
    .toBe('1');
  // La barra indirizzi (.addr) non è visibile.
  const addrDisplay = await shell.evaluate(() => {
    const el = document.querySelector('.addr');
    return el ? getComputedStyle(el).display : 'missing';
  });
  expect(addrDisplay).toBe('none');
  // La shell si riduce alla sola fila di tab (40px).
  const shellH = await shell.evaluate(() => {
    const el = document.querySelector('header.shell');
    return el ? Math.round(el.getBoundingClientRect().height) : -1;
  });
  expect(shellH).toBe(40);
});

test("L'icona profilo della barra mostra l'avatar quando loggato", async ({ app }) => {
  const barra = await barraPage(app);
  const account = barra.locator('#fisse [data-comando="account"]');
  await expect(account.locator('img.avatar')).toHaveCount(0);
  await expect(account).toHaveAttribute('aria-label', 'Accedi');

  // Il login arriva alla shell come dopo il sign-in; la shell lo passa alla barra. La foto è la copia che il main
  // tiene nella cartella dati (#1273): un indirizzo di Google la barra non lo carica.
  const accedi = (pic) => app.evaluate(({ BrowserWindow }, p) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.webContents.send('filo:broadcast', {
      type: 'auth_changed', signedIn: true,
      profile: { name: 'Mario Rossi', email: 'mario@example.it', picture: p },
    });
  }, pic);
  await accedi('https://lh3.googleusercontent.com/a/foto-di-prova');
  await expect(account).toHaveAttribute('aria-label', 'Profilo: Mario Rossi');
  await expect(account.locator('img.avatar')).toHaveCount(0);
  const copia = await app.evaluate(() => globalThis.__filoCopieIcone.conserva(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4YaMBAAL8AS3/gzpXAAAAAElFTkSuQmCC'));
  await accedi(copia);
  await expect(account.locator('img.avatar')).toHaveAttribute('src', copia);
  await expect.poll(() => account.locator('img.avatar').evaluate((i) => i.naturalWidth)).toBe(1);

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.webContents.send('filo:broadcast', { type: 'auth_changed', signedIn: false, profile: null });
  });
  await expect(account).toHaveAttribute('aria-label', 'Accedi');
  await expect(account.locator('img.avatar')).toHaveCount(0);
});

test("Cliccare App nella barra apre il menu nativo della shell", async ({ app }) => {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.click('#fisse [data-comando="apps"]');
  // Il menu riusa una finestra nata con la barra (#1090): si guarda che compaia con le voci delle App.
  const menu = await menuAperto(app, { tetto: 6_000 });
  expect(menu, 'il menu App non si è aperto').toBeTruthy();
  await expect(menu.locator('.menu')).toContainText('Editor');
});
