// #876 giro 3 — fra i programmi fidati Filo non deve proporre né accettare come sito di uno solo un indirizzo che serve i
// file di chiunque attraverso il percorso. Le porte dei giri 1 e 2 (githubusercontent, googleapis) si ri-provano qui.

import { test, expect } from '../../fixtures/electron.mjs';

const pagina = async (openTab) => {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('#sec-dl-trusted', { state: 'attached', timeout: 10_000 });
  return sec;
};

test('porte dei giri 1 e 2, chiuse: release GitHub e secchi Google Cloud', async ({ openTab }) => {
  const sec = await pagina(openTab);
  const r = await sec.evaluate(() => {
    const E = window.SN_ESEGUIBILI;
    return {
      gh: E.testoPiattaforma('githubusercontent.com', ['github.com', 'release-assets.githubusercontent.com']),
      gcs: E.testoPiattaforma('googleapis.com', ['storage.googleapis.com', 'firebasestorage.googleapis.com']),
      host: ['release-assets.githubusercontent.com', 'storage.googleapis.com', 'firebasestorage.googleapis.com']
        .map((h) => !!(E.sitoFidabile(h) || {}).sito),
    };
  });
  expect(r.gh).not.toContain('release-assets.githubusercontent.com');
  expect(r.gcs).not.toContain('storage.googleapis.com');
  expect(r.host).toEqual([false, false, false]);
});

test('r1 dopo un programma da un secchio Amazon S3 per regione, Filo non propone la regione intera', async ({ openTab }) => {
  const sec = await pagina(openTab);
  const r = await sec.evaluate(() => {
    const E = window.SN_ESEGUIBILI;
    return {
      frase: E.testoPiattaforma('amazonaws.com', ['s3.eu-west-1.amazonaws.com']),
      regione: E.sitoFidabile('eu-west-1.amazonaws.com'),
      altro: E.fidato('https://s3.eu-west-1.amazonaws.com/secchio-di-un-altro/setup.exe', ['eu-west-1.amazonaws.com']),
    };
  });
  expect(r.frase).not.toContain('eu-west-1.amazonaws.com');
  expect(r.regione && r.regione.sito).toBeFalsy();
  expect(r.altro).toBe(false);
});

test('r1 fidarsi di un sito Google o Discord non fa scendere i file che chiunque condivide da lì', async ({ openTab }) => {
  const sec = await pagina(openTab);
  const r = await sec.evaluate(() => {
    const E = window.SN_ESEGUIBILI;
    return [
      E.fidato('https://drive.usercontent.google.com/download?id=1abc&export=download', ['dl.google.com']),
      E.fidato('https://sites.google.com/view/chiunque/setup.exe', ['google.com']),
      E.fidato('https://cdn.discordapp.com/attachments/1/2/setup.exe', ['discordapp.com']),
      E.fidato('https://media.discordapp.net/attachments/1/2/setup.exe', ['dl.discordapp.net']),
    ];
  });
  expect(r).toEqual([false, false, false, false]);
});
