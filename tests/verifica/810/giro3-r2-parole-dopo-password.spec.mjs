// Verifica #810, giro 3, rilievo 2: la parola che segue «Password» su una pagina di accesso
// («dimenticata?», «(obbligatoria)») viene presa per una password, e l'uscita che la usa si ferma.

import { test, expect } from '../../fixtures/electron.mjs';
import { preparaModelli, modelloFinto, ricercheFinte, apriAiuto, scriviAllAiuto } from './aiuti.mjs';

const LOGIN = `<!doctype html><html><head><title>Accedi</title></head>
<body style="padding:40px;font:16px sans-serif"><h1>Accedi</h1>
<label>Email <input type="email"></label><br>
<label>Password (obbligatoria) <input type="password"></label><br>
<a href="/recupero">Password dimenticata?</a><br><button>Accedi</button></body></html>`;

for (const query of ['come recuperare una password dimenticata', 'campo obbligatoria password cosa inserire']) {
  test(`sulla pagina di accesso l’assistente cerca «${query}»`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, LOGIN);
    await preparaModelli(app);
    await ricercheFinte(app, [{ title: 'Guida', url: 'https://guida.example/recupero', snippet: 'Come fare.' }]);
    await modelloFinto(app, {
      aiuto: [
        ['Risultati', '{"text":"Ecco come fare.","status":"done"}'],
        ['', JSON.stringify({ action: 'web_search', query })],
      ],
    });
    await apriAiuto(shell, page);
    await scriviAllAiuto(page, 'non ricordo la password, come faccio?');
    await expect.poll(async () => {
      if (await page.locator('.sn-sidebar-log', { hasText: 'non ho fatto la ricerca' }).count()) return 'fermata';
      return (await app.evaluate(() => globalThis.__ricerche.length)) ? 'partita' : 'niente';
    }, { timeout: 20_000 }).not.toBe('niente');
    await expect(page.locator('.sn-sidebar-log', { hasText: 'non ho fatto la ricerca' })).toHaveCount(0);
    expect(await app.evaluate(() => globalThis.__ricerche)).toEqual([query]);
  });
}
