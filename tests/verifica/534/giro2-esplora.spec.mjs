import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');

test('esplora: preferenze fidati, tanti indirizzi, tema scuro e chiaro', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const mittenti = [];
    mittenti.push({ indirizzo: `${'nome.cognome.molto.lungo.'.repeat(6)}x@dominio-lunghissimo-di-prova.example.org`, via: 'mano', dal: 1 });
    for (let i = 0; i < 40; i++) mittenti.push({ indirizzo: `persona${i}@esempio.it`, via: i % 2 ? 'inviati' : 'mano', dal: 1 });
    await globalThis.SN_STORAGE.setRaw('filo_fiducia', { mittenti, siti: [{ sito: 'bancaesempio.it', dal: 1 }] });
  });
  const page = await openTab('filo://preferences/');
  await page.waitForLoadState('domcontentloaded');
  const sezione = page.locator('#sec-schede');
  await expect(sezione.locator('#fidatiMittentiConto')).toHaveText('(41)');
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await sezione.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await sezione.screenshot({ path: join(SHOTS, `v534-fidati-${scheme}.png`) });
  }
  const largo = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(largo).toBe(false);
});
