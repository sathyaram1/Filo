// Verifica #843 giro 2, rilievo 1: più siti sulla stessa riga della pagina Altro quando il primo è un indirizzo
// intero, o quando le colonne sono separate da un tab (una riga incollata da un foglio): la chat li prende tutti.

import { test, expect } from '../../fixtures/electron.mjs';

const A = 'docs.filo-843.test';
const B = 'altro-843.test';

const esclusi = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).blocklist);

async function incolla(app, openTab, testo) {
  const altro = await openTab('filo://options/altro.html');
  const casella = altro.locator('#blocklist');
  await expect(casella).toHaveValue('', { timeout: 8000 });
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);
  await casella.click();
  await altro.keyboard.press('Control+V');
  await altro.locator('#h-blocklist').click();
  return altro;
}

test('r1 due indirizzi interi incollati sulla stessa riga spengono Filo su tutti e due', async ({ app, openTab }) => {
  await incolla(app, openTab, `https://${A}/document/d/x https://${B}/file/y`);
  await expect.poll(() => esclusi(app), { timeout: 5000 }).toEqual([A, B]);
});

test('r1 un sito con percorso e un altro dopo la virgola spengono Filo su tutti e due', async ({ app, openTab }) => {
  await incolla(app, openTab, `${A}/document, ${B}`);
  await expect.poll(() => esclusi(app), { timeout: 5000 }).toEqual([A, B]);
});

test('r1 due siti separati da un tab non diventano un sito solo', async ({ app, openTab }) => {
  await incolla(app, openTab, `${A}\t${B}`);
  await expect.poll(() => esclusi(app), { timeout: 5000 }).toEqual([A, B]);
});
