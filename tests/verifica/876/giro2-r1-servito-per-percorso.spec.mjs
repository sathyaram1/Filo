// #876 giro 2 — fra i programmi fidati Filo non deve proporre, né accettare come sito qualunque, un indirizzo che serve
// i file di chiunque attraverso il percorso: storage.googleapis.com/<secchio>/… dà i file di ogni cliente di Google Cloud.
// I siti scaricati si passano come la pagina Sicurezza li riceve dall'elenco dei download.

import { test, expect } from '../../fixtures/electron.mjs';

test('porta del giro 1, chiusa: dopo una release GitHub non si propone l\'host delle release di tutti', async ({ openTab }) => {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('#sec-dl-trusted', { state: 'attached', timeout: 10_000 });
  const frase = await sec.evaluate(() => window.SN_ESEGUIBILI.testoPiattaforma('githubusercontent.com',
    ['github.com', 'release-assets.githubusercontent.com']));
  expect(frase).toContain('«githubusercontent.com» raccoglie i siti di chiunque');
  expect(frase).not.toContain('release-assets.githubusercontent.com');
  const v = await sec.evaluate(() => window.SN_ESEGUIBILI.sitoFidabile('release-assets.githubusercontent.com'));
  expect(v && v.sito).toBeFalsy();
});

test('r1 dopo un programma da Google Cloud Storage, chi scrive googleapis.com non si sente proporre l\'host dei secchi di tutti', async ({ openTab }) => {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('#sec-dl-trusted', { state: 'attached', timeout: 10_000 });
  const frase = await sec.evaluate(() => window.SN_ESEGUIBILI.testoPiattaforma('googleapis.com',
    ['storage.googleapis.com', 'firebasestorage.googleapis.com']));
  expect(frase).toContain('«googleapis.com» raccoglie i siti di chiunque');
  expect(frase).not.toContain('storage.googleapis.com');
  // Scritto a mano, quell'host non diventa un sito fidato come un altro: coprirebbe i programmi di ogni secchio.
  for (const h of ['storage.googleapis.com', 'firebasestorage.googleapis.com']) {
    const v = await sec.evaluate((x) => window.SN_ESEGUIBILI.sitoFidabile(x), h);
    expect(v && v.sito, h).toBeFalsy();
  }
  const fidato = await sec.evaluate(() => window.SN_ESEGUIBILI.fidato(
    'https://storage.googleapis.com/secchio-di-un-altro/setup.exe', ['storage.googleapis.com']));
  expect(fidato).toBe(false);
});
