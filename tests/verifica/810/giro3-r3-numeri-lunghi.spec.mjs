// Verifica #810, giro 3, rilievo 3: un numero lungo qualsiasi che passa il controllo delle carte
// (uno su dieci: l'identificativo di un video, un numero d'ordine) viene preso per una carta letta
// da fuori, e l'uscita che lo usa si ferma.

import { test, expect } from '../../fixtures/electron.mjs';
import { preparaModelli, modelloFinto, ricercheFinte, apriAiuto, scriviAllAiuto, apertoVerso, newtab } from './aiuti.mjs';

// Identificativi con la cifra di controllo delle carte giusta, come uno su dieci di quelli veri.
const VIDEO = 'https://www.tiktok.com/@cucina/video/7234567890123456789';
const ORDINE = '402-1234567-1234564';

test('la chat apre il video che ha appena trovato con una ricerca', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaModelli(app);
  await ricercheFinte(app, [{ title: 'Carbonara in 5 minuti', url: VIDEO, snippet: 'La ricetta originale.' }]);
  await modelloFinto(app, {
    giri: [
      { toolCalls: [{ id: 'r1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'video carbonara tiktok' }) }] },
      { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: VIDEO }) }] },
      { text: 'Ti ho aperto il video.' },
    ],
  });
  await page.locator('#input').fill('trovami un video della carbonara e aprilo');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ti ho aperto il video.' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.dash-activity-row', { hasText: 'Non ho aperto' })).toHaveCount(0);
  await expect.poll(() => apertoVerso(app, 'tiktok.com'), { timeout: 5_000 }).toBe(true);
});

test('l’assistente cerca il numero dell’ordine che ha sulla pagina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>I tuoi ordini</title></head>
    <body style="padding:40px;font:16px sans-serif"><h1>Dettagli ordine</h1>
    <p>Ordine n. ${ORDINE}</p><p>Totale: 34,90 €</p><p>Consegna prevista: 3 ottobre</p></body></html>`);
  await preparaModelli(app);
  await ricercheFinte(app, [{ title: 'Assistenza', url: 'https://assistenza.example/ordini', snippet: 'Ordini in ritardo.' }]);
  const query = `ordine ${ORDINE} in ritardo`;
  await modelloFinto(app, {
    aiuto: [
      ['avevi chiesto', '{"text":"Ecco cosa ho trovato.","status":"done"}'],
      ['', JSON.stringify({ action: 'web_search', query })],
    ],
  });
  await apriAiuto(shell, page);
  await scriviAllAiuto(page, 'il pacco non arriva, cerca cosa posso fare');
  await expect.poll(async () => {
    if (await page.locator('.sn-sidebar-log', { hasText: 'non ho fatto la ricerca' }).count()) return 'fermata';
    return (await app.evaluate(() => globalThis.__ricerche.length)) ? 'partita' : 'niente';
  }, { timeout: 20_000 }).not.toBe('niente');
  await expect(page.locator('.sn-sidebar-log', { hasText: 'non ho fatto la ricerca' })).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__ricerche)).toEqual([query]);
});
