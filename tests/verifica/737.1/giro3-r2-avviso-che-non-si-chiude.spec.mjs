// Verifica #737.1 giro 3, rilievo 2: l'avviso del popup bloccato di una pagina che riprova di continuo si può chiudere.
import { test, expect } from '../../fixtures/electron.mjs';

test('chiuso l\'avviso «Bloccato popup», la pagina che riprova ogni secondo non lo fa ricomparire', async ({ openTab, testServer, avvisi }) => {
  await openTab(testServer.html('<title>Catena</title><p>articolo</p><script>setInterval(function(){window.open(location.href)},1000)</script>'));
  const vista = await avvisi();
  const carta = vista.locator('.shell-notif.show', { hasText: 'Bloccato popup' });
  await expect(carta).toBeVisible({ timeout: 8000 });
  await carta.locator('.shell-notif-close').click();
  await new Promise((r) => setTimeout(r, 3000));
  await expect(vista.locator('.shell-notif.show', { hasText: 'Bloccato popup' })).toHaveCount(0);
});
