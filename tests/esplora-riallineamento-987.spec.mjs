import { test, expect } from './fixtures/electron.mjs';

test('privacy: testo della bacheca e contatori di main convivono', async ({ openTab }) => {
  const page = await openTab('filo://transparency/transparency.html?doc=privacy');
  const corpo = page.locator('body');
  await expect(corpo).toContainText('il testo riscritto per la bacheca');
  await expect(corpo).toContainText('Gli indirizzi email li toglie anche un controllo che non usa modelli');
  await expect(corpo).toContainText('Manda i contatori anonimi');
  await expect(corpo).toContainText('Lo pseudonimo dei contatori non è anonimato');
});
