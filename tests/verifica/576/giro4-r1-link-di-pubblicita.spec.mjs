// Giro 4, rilievo 1: un link verso un server delle liste cliccato dall'utente non deve restare senza risposta.
// Successo: la scheda lascia l'articolo (arriva al sito, a una pagina d'errore o a una che spiega il blocco).
import { test, expect } from '../../fixtures/electron.mjs';

const CASI = [
  ['regola solo per script e riquadri di terzi', '||skimresources.com^$script,subdocument,third-party', 'https://go.skimresources.com/?id=1X&url=https%3A%2F%2Fexample.com%2F'],
  ['annuncio sponsorizzato di una ricerca', '0.0.0.0 www.googleadservices.com', 'https://www.googleadservices.com/pagead/aclk?sa=L&adurl=https%3A%2F%2Fexample.com%2F'],
];

for (const [nome, regola, link] of CASI) {
  test(`un link cliccato verso un server in lista porta da qualche parte (${nome})`, async ({ app, openTab, testServer }) => {
    await app.evaluate(({}, r) => {
      const A = globalThis.__filoAdblock;
      A.setDomainsForTest([...A.parseList(r)]);
      A.configureFromSettings({ security: { adblock: { enabled: true } } });
    }, regola);
    const page = await testServer.openReady(openTab, `<!doctype html><title>ART</title><a id="l" href="${link}">Compra qui</a>`, { pubblico: true });
    const articolo = page.url();
    await page.evaluate(() => document.getElementById('l').click());
    await expect.poll(async () => {
      const urls = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()));
      return urls.includes(articolo);
    }, { timeout: 8_000 }).toBe(false);
  });
}
