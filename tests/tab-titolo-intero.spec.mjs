// #429: con la fila delle schede mezza vuota ogni scheda mostra il titolo intero, e la scheda di Gestione
// aperta ha il colore della cima della pagina, in chiaro e in scuro. Le misure si leggono dentro le attese:
// la striscia si ridisegna quando il main annuncia le schede, e prima di quel frame le larghezze sono zero.

import { test, expect } from './fixtures/electron.mjs';
import { captureCompositeElectron } from './agent/driver.mjs';

async function verdettoTitoli(shell) {
  return shell.evaluate(() => {
    const fila = document.querySelector('.tab-row').getBoundingClientRect().width;
    const striscia = document.querySelector('.tabs').getBoundingClientRect().width;
    const schede = [...document.querySelectorAll('.tab')].map((el) => {
      const t = el.querySelector('.title');
      return {
        titolo: t.textContent,
        attiva: el.classList.contains('active'),
        w: el.getBoundingClientRect().width,
        testo: t.scrollWidth,
        posto: t.clientWidth,
      };
    });
    if (schede.length < 3 || schede.some((s) => !(s.w > 0))) return 'striscia non ancora disegnata';
    if (!(striscia + 100 < fila)) return `fila senza posto: striscia ${striscia} su ${fila}`;
    const tagliati = schede.filter((s) => s.testo > s.posto + 0.5);
    if (tagliati.length) return `titoli tagliati: ${tagliati.map((s) => `«${s.titolo}» ${s.posto}/${s.testo}`).join(', ')}`;
    const attiva = schede.find((s) => s.attiva);
    if (schede.some((s) => !s.attiva && s.w >= attiva.w)) return `attiva non più larga: ${schede.map((s) => s.w).join(' ')}`;
    return 'titoli interi';
  });
}

const fondoAttiva = (shell) => shell.evaluate(() => getComputedStyle(document.querySelector('.tab.active')).backgroundColor);
const cimaPagina = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('#429 — con la fila libera nessun titolo resta a metà, e Gestione continua nella sua scheda', async ({ app, shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>Memoria del sito di prova</title><body>ciao</body>'));
  const gestione = await openTab('filo://manage/manage.html');
  await gestione.waitForLoadState('domcontentloaded');

  await expect.poll(() => verdettoTitoli(shell), { timeout: 10_000 }).toBe('titoli interi');

  // Passare a un'altra scheda non stringe le altre fino a tagliarne il titolo.
  await shell.locator('.tab', { hasText: 'Memoria del sito di prova' }).click();
  await expect(shell.locator('.tab.active .title')).toHaveText('Memoria del sito di prova');
  await expect.poll(() => verdettoTitoli(shell), { timeout: 10_000 }).toBe('titoli interi');

  await shell.locator('.tab', { hasText: 'Gestione' }).click();
  await expect(shell.locator('.tab.active .title')).toHaveText('Gestione');
  const chiaro = await cimaPagina(gestione);
  await expect.poll(() => fondoAttiva(shell), { timeout: 10_000 }).toBe(chiaro);
  await captureCompositeElectron(app, 'tests/.shots/tab-titolo-intero-chiaro.png');

  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await expect.poll(() => cimaPagina(gestione), { timeout: 10_000 }).not.toBe(chiaro);
  // Playwright tiene la shell in chiaro per conto suo: lo scuro glielo chiede lui.
  await shell.emulateMedia({ colorScheme: 'dark' });
  const scuro = await cimaPagina(gestione);
  await expect.poll(() => fondoAttiva(shell), { timeout: 10_000 }).toBe(scuro);
  await expect.poll(() => verdettoTitoli(shell), { timeout: 10_000 }).toBe('titoli interi');
  await captureCompositeElectron(app, 'tests/.shots/tab-titolo-intero-scuro.png');
});

const rettangolo = (shell, testo) => shell.locator('.tab', { hasText: testo })
  .evaluate((el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), w: Math.round(r.width) }; });

// Le schede si dividono la fila a parti uguali: il titolo più lungo che si accorcia le stringerebbe tutte, e quella
// sotto il puntatore gli scapperebbe da sotto. Si adattano quando il puntatore lascia la fila.
test('#429 — un titolo che cambia non sposta la scheda sotto il puntatore, poi la fila si adatta', async ({ app, shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>Gestione</title><body>uno</body>'));
  const lunga = await openTab(testServer.html('<title>Una pagina col titolo più lungo di tutti</title><body>due</body>'));
  await expect.poll(() => verdettoTitoli(shell), { timeout: 10_000 }).toBe('titoli interi');

  await shell.locator('.tab', { hasText: 'Gestione' }).click();
  await expect(shell.locator('.tab.active .title')).toHaveText('Gestione');
  const prima = await rettangolo(shell, 'titolo più lungo');
  await shell.mouse.move(prima.x + 12, 24);

  await lunga.evaluate(() => { document.title = 'Corto'; });
  await expect(shell.locator('.tab .title', { hasText: 'Corto' })).toBeVisible();
  expect(await rettangolo(shell, 'Corto')).toEqual(prima);

  await shell.mouse.move(600, 500);
  await expect.poll(async () => (await rettangolo(shell, 'Corto')).w, { timeout: 5_000 }).toBeLessThan(prima.w);
  await expect.poll(() => verdettoTitoli(shell), { timeout: 10_000 }).toBe('titoli interi');
});
