// #876 giro 1 — fra i programmi fidati Filo non deve proporre come «sito preciso» un host che serve i file di chiunque:
// dopo un programma da una release GitHub (pagina github.com, file servito da release-assets.githubusercontent.com), chi
// scrive githubusercontent.com non deve sentirsi dire di scrivere l'host delle release di tutti.
// github.com è nella lista HSTS: non lo si serve in http dal mini server, quindi i siti scaricati si passano come la
// pagina Sicurezza li riceve dall'elenco dei download (sito e servito da).

import { test, expect } from '../../fixtures/electron.mjs';

test('r1 dopo una release GitHub, chi scrive githubusercontent.com non si sente proporre l\'host delle release di tutti', async ({ openTab }) => {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('#sec-dl-trusted', { state: 'attached', timeout: 10_000 });
  const frase = await sec.evaluate(() => window.SN_ESEGUIBILI.testoPiattaforma('githubusercontent.com',
    ['github.com', 'release-assets.githubusercontent.com']));
  expect(frase).toContain('«githubusercontent.com» raccoglie i siti di chiunque');
  expect(frase).not.toContain('release-assets.githubusercontent.com');
  // E scritto a mano, quell'host non diventa un sito fidato come un altro.
  const v = await sec.evaluate(() => window.SN_ESEGUIBILI.sitoFidabile('release-assets.githubusercontent.com'));
  expect(v && v.sito).toBeFalsy();
});
