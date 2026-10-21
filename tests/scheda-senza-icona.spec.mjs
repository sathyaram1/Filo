// #1460 — una scheda di un sito che non ha icona mostrava un posto vuoto prima del titolo, come un'icona che non si è
// caricata. Adesso prende il globo, come la home per lo stesso sito; quando l'icona c'è, il globo non compare.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const SHOTS = join('tests', '.shots');

const statoIcone = (shell) => shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((t) => {
  const ico = t.querySelector('.favicon, .spinner');
  const svg = ico && ico.querySelector('svg');
  const r = svg ? svg.getBoundingClientRect() : null;
  return {
    titolo: t.querySelector('.title')?.textContent || '',
    classe: ico ? ico.className : '',
    globo: !!svg && r.width > 0 && r.height > 0 && getComputedStyle(ico).display !== 'none'
      && Number(getComputedStyle(ico).opacity) > 0.3,
    sfondo: ico ? ico.style.backgroundImage : '',
  };
}));

async function schedaDi(shell, titolo) {
  let voce = null;
  await expect.poll(async () => {
    voce = (await statoIcone(shell)).find((s) => s.titolo === titolo) || null;
    return voce ? voce.classe : '';
  }, { timeout: 15_000, message: `la scheda «${titolo}» doveva finire di caricare` }).toMatch(/favicon/);
  return voce;
}

test('un sito senza icona mostra il globo nella scheda, attiva e dietro, in tema chiaro e scuro', async ({ app, shell, openTab, testServer }) => {
  const senza = testServer.html('<!doctype html><meta charset="utf-8"><title>Ricette di stagione</title><h1>Zuppa</h1>');
  await openTab(senza);
  await expect.poll(async () => (await schedaDi(shell, 'Ricette di stagione')).globo, {
    timeout: 15_000, message: 'la scheda attiva senza icona doveva mostrare il globo',
  }).toBe(true);

  // Dietro un'altra scheda resta il globo, e il nome si legge ancora per intero.
  const icona = testServer.asset(Buffer.from(PNG_B64, 'base64'), 'image/png');
  await openTab(testServer.html(`<!doctype html><meta charset="utf-8"><title>Con icona</title><link rel="icon" href="${icona}"><p>x</p>`));
  await expect.poll(async () => (await schedaDi(shell, 'Con icona')).sfondo, { timeout: 15_000 }).toContain('data:image/png');
  const dietro = await schedaDi(shell, 'Ricette di stagione');
  expect(dietro.globo, 'la scheda dietro, senza icona, doveva tenere il globo').toBe(true);
  const conIcona = await schedaDi(shell, 'Con icona');
  expect(conIcona.globo, 'una scheda con la sua icona non deve mostrare anche il globo').toBe(false);

  mkdirSync(SHOTS, { recursive: true });
  await shell.locator('.tab-row').screenshot({ path: join(SHOTS, 'scheda-senza-icona-chiaro.png') });
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await shell.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await schedaDi(shell, 'Ricette di stagione')).globo).toBe(true);
  await shell.locator('.tab-row').screenshot({ path: join(SHOTS, 'scheda-senza-icona-scuro.png') });
});

test('la scheda che passa da un sito senza icona a uno con l\'icona perde il globo', async ({ shell, openTab, testServer }) => {
  const icona = testServer.asset(Buffer.from(PNG_B64, 'base64'), 'image/png');
  const con = testServer.html(`<!doctype html><meta charset="utf-8"><title>Arrivo</title><link rel="icon" href="${icona}"><p>x</p>`);
  const pagina = await openTab(testServer.html('<!doctype html><meta charset="utf-8"><title>Partenza</title><p>x</p>'));
  await expect.poll(async () => (await schedaDi(shell, 'Partenza')).globo, { timeout: 15_000 }).toBe(true);
  await pagina.goto(con);
  await expect.poll(async () => {
    const s = await schedaDi(shell, 'Arrivo');
    return { icona: s.sfondo.includes('data:image/png'), globo: s.globo };
  }, { timeout: 15_000, message: 'arrivata l\'icona, il globo doveva andarsene' }).toEqual({ icona: true, globo: false });
});
