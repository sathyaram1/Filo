// r2: le voci del tasto destro che usano l'indirizzo di una foto della risposta ricevono quello della copia interna.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { NEWTAB, preparaImmagini, stubModello, chiedi } from './aiuti.mjs';

async function fotoInRisposta(app, openTab) {
  await preparaImmagini(app, 2);
  await stubModello(app, [{ strumento: { azione: 'immagini', query: 'antilope' } }, { testo: 'Ecco.\n\n[[immagini: $ID0, $ID1]]\n\nFine.' }]);
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  const img = page.locator('.dash-bubble-filo .filo-galleria-img').first();
  await expect(img).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => img.evaluate((e) => e.complete && e.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
  return { page, img };
}

test('r2 «Copia URL immagine» copia un indirizzo del web, non quello interno di Filo', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  const { page, img } = await fotoInRisposta(app, openTab);
  await app.evaluate(({ clipboard }) => clipboard.clear());
  await img.click({ button: 'right' });
  const menu = menuDi(page);
  await menu.voce('Copia URL immagine').click();
  await expect.poll(() => app.evaluate(async ({ clipboard }) => clipboard.readText()), { timeout: 8000 }).toMatch(/^https:\/\//);
});

test('r2 «Salva immagine come…» salva la foto su disco', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  const fs = await import('node:fs');
  const { page, img } = await fotoInRisposta(app, openTab);
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR || '');
  expect(dir).not.toBe('');
  await img.click({ button: 'right' });
  await menuDi(page).voce('Salva immagine come').click();
  await expect.poll(() => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !/\.part$|crdownload$/i.test(f)).length : 0), { timeout: 15_000 }).toBeGreaterThan(0);
});

test('r2 «Cerca immagine» manda al motore un indirizzo che il motore può aprire', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  const { page, img } = await fotoInRisposta(app, openTab);
  await img.click({ button: 'right' });
  const menu = menuDi(page);
  await menu.voce('Cerca immagine').click();
  const lens = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()).find((u) => /lens\.google/.test(u)) || '');
  await expect.poll(lens, { timeout: 10_000 }).toMatch(/lens\.google/);
  expect(decodeURIComponent(await lens())).not.toContain('filo://');
});
