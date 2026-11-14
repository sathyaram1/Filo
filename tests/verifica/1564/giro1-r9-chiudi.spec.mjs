// Verifica #1564 giro 1, rilievo 4: dopo aver aperto due siti, «chiudi le schede» a Normale chiede conferma invece di
// chiuderle, come su main. Modello finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

test('r4 «chiudi tutte le schede tranne questa» con scheda(chiudi): resta solo la home con la chat, senza conferma', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await openTab(testServer.html('<title>Ricetta</title><p>ricetta'));
  await openTab(testServer.html('<title>Meteo</title><p>meteo'));
  await expect(shell.locator('.tab')).toHaveCount(3, { timeout: 10_000 });
  await shell.locator('.tab').first().click();
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'c1', name: 'scheda', arguments: JSON.stringify({ azione: 'chiudi', tutte: true }) }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'chiudi tutte le schede tranne questa');
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  await ripristina(app);
});
