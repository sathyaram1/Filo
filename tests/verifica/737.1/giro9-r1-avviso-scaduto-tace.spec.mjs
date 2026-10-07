// #737.1 giro 9: scaduto il primo avviso, una finestra bloccata dopo sulla stessa pagina deve ancora farsi vedere.
import { test, expect } from '../../fixtures/electron.mjs';

test('r1 scaduto l\'avviso, il blocco successivo sulla stessa pagina ha ancora il suo avviso con «Apri»', async ({ openTab, testServer, avvisi }) => {
  const dest = testServer.html('<title>PAGA</title>');
  await openTab(testServer.html(`<title>Negozio</title><p>articolo</p><script>var D=${JSON.stringify(dest)};
    setTimeout(function(){window.open(D)},600);setTimeout(function(){window.open(D)},14000);</script>`));
  const vista = await avvisi();
  const carta = vista.locator('.shell-notif.show', { hasText: 'Bloccato popup' });
  await expect(carta).toBeVisible({ timeout: 8000 });
  await expect(carta).toHaveCount(0, { timeout: 12000 });
  await new Promise((r) => setTimeout(r, 4500));
  await expect(vista.locator('.shell-notif.show', { hasText: 'Bloccato popup' }), 'il secondo blocco ha un avviso').toHaveCount(1);
});
