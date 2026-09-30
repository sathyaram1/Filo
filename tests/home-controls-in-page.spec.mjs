// Feedback 1tsAuna tolse la barra in alto di Filo; #871 porta le sei icone che erano finite in alto
// a destra nella home (red-team, home, cronologia, impostazioni, app, profilo) nella barra laterale.
// Gli assert verificano il SUCCESSO: la home non ha più la fila, le voci stanno nella barra, il
// profilo mostra l'avatar e App apre davvero il menu nativo accanto alla barra.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo } from './helpers/barra.mjs';

test('La home non ha più la fila di icone in alto: le voci stanno nella barra laterale', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#dashControls, .dash-ctrl')).toHaveCount(0);
  const barra = await barraPage(app);
  const nav = await barra.$$eval('#nav .ico', (els) => els.map((e) => e.dataset.id));
  expect(nav).toContain('home');
  const fisse = await barra.$$eval('#fisse .ico', (els) => els.map((e) => e.dataset.comando));
  expect(fisse).toEqual(['history', 'apps', 'redteam', 'account', 'settings']);
  // Ogni voce ha il suo disegno, non una lettera di ripiego.
  expect(await barra.$$eval('#pannello .ico svg', (els) => els.length)).toBe(nav.length + fisse.length);
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

  // Il login arriva alla shell come dopo il sign-in; la shell lo passa alla barra. Una foto vera
  // (https) non si carica nei test: l'errore riporta l'icona, quindi si guarda l'etichetta e la src.
  const picture = 'https://lh3.googleusercontent.com/a/foto-di-prova';
  await app.evaluate(({ BrowserWindow }, pic) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.webContents.send('filo:broadcast', {
      type: 'auth_changed', signedIn: true,
      profile: { name: 'Mario Rossi', email: 'mario@example.it', picture: pic },
    });
  }, picture);
  await expect(account).toHaveAttribute('aria-label', 'Profilo: Mario Rossi');

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
  const popupBefore = app.windows().filter((w) => (w.url() || '').startsWith('data:text/html')).length;
  await barra.click('#fisse [data-comando="apps"]');
  await expect
    .poll(() => app.windows().filter((w) => (w.url() || '').startsWith('data:text/html')).length, { timeout: 6_000 })
    .toBeGreaterThan(popupBefore);
});
