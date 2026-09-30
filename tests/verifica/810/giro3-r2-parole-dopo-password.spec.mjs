// Verifica #810, giro 3, rilievo 2: la prima parola con un segno che segue «password» (su una pagina di accesso,
// nel titolo di un risultato) viene presa per una password, e l’uscita che la usa si ferma.

import { test, expect } from '../../fixtures/electron.mjs';
import { preparaModelli, modelloFinto, ricercheFinte, apriAiuto, scriviAllAiuto, apertoVerso, newtab } from './aiuti.mjs';

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
        ['avevi chiesto', '{"text":"Ecco come fare.","status":"done"}'],
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

test('la chat apre la guida che ha trovato cercando come reimpostare la password', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaModelli(app);
  const guida = 'https://assistenza.example/articolo/374546259294234';
  await ricercheFinte(app, [{ title: 'Reimpostare la password', url: guida, snippet: 'Segui questi passaggi.' }]);
  await modelloFinto(app, {
    giri: [
      { toolCalls: [{ id: 'r1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'come reimpostare la password' }) }] },
      { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: guida }) }] },
      { text: 'Ti ho aperto la guida.' },
    ],
  });
  await page.locator('#input').fill('come reimposto la password? aprimi una guida');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ti ho aperto la guida.' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.dash-activity-row', { hasText: 'Non ho aperto' })).toHaveCount(0);
  await expect.poll(() => apertoVerso(app, 'assistenza.example'), { timeout: 5_000 }).toBe(true);
});
