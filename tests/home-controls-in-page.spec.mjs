// Feedback 1tsAuna: "leva questa barra, metti le icone nel contenuto della
// pagina home". La barra in alto di Filo (indietro/avanti/ricarica +
// home/impostazioni/app/profilo) è stata rimossa: indietro/avanti/ricarica
// vivono nel menu tasto destro, mentre home/impostazioni/app/profilo sono ora
// icone DENTRO la home, in alto a destra. Cliccarle apre i menu reali della
// shell (nessuna logica duplicata).
//
// Gli assert verificano il SUCCESSO: le icone esistono nella home, la barra in
// alto non c'è più (chrome compatto), e il click apre davvero il menu nativo.

import { test, expect } from './fixtures/electron.mjs';

test('La home mostra le icone di controllo (home/impostazioni/app/profilo)', async ({ openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForSelector('#dashControls .dash-ctrl', { timeout: 8_000 });
  const commands = await page.$$eval('#dashControls .dash-ctrl', (els) => els.map((e) => e.dataset.command));
  expect(commands).toEqual(['home', 'settings', 'apps', 'account']);
  // Ogni icona ha un'immagine SVG (non un fallback testuale).
  const svgs = await page.$$eval('#dashControls .dash-ctrl svg', (els) => els.length);
  expect(svgs).toBe(4);
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

test("Cliccare l'icona App nella home apre il menu nativo della shell", async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForSelector('#dashControls .dash-ctrl[data-command="apps"]', { timeout: 8_000 });

  const popupBefore = app.windows().filter((w) => (w.url() || '').startsWith('data:text/html')).length;
  await page.click('#dashControls .dash-ctrl[data-command="apps"]');

  // Il bridge page → main → shell → click bottone reale apre un popup-menu
  // (BrowserWindow su data:text/html). Comparsa = bridge funzionante.
  await expect
    .poll(() => app.windows().filter((w) => (w.url() || '').startsWith('data:text/html')).length, { timeout: 6_000 })
    .toBeGreaterThan(popupBefore);
});
