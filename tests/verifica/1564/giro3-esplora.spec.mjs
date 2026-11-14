// Esplorazione, da cancellare.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina, chiamateAlModello } from '../../helpers/chatFinta.mjs';
import fs from 'node:fs';

test('esplora chiudi', async ({ app, shell, openTab, testServer }) => {
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
  await page.waitForTimeout(6000);
  fs.mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/1564-esplora.png' });
  const calls = await chiamateAlModello(app);
  const testo = await page.locator('body').innerText();
  fs.writeFileSync('tests/.shots/1564-esplora.txt', testo + '\n\n=====\n' + JSON.stringify(calls.map((m) => m.slice(-3)), null, 1).slice(0, 20000)
    + '\n=====SYSTEM\n' + JSON.stringify(calls[0] && calls[0].filter((x) => x.role === 'system').map((x) => (typeof x.content === 'string' ? x.content : JSON.stringify(x.content)).slice(-6000))));
  await ripristina(app);
});
