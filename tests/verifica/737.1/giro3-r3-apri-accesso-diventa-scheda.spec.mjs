// Verifica #737.1 giro 3, rilievo 3: «Apri» sull'avviso di una finestra di accesso bloccata apre la finestra vera, non una scheda.
import { test, expect } from '../../fixtures/electron.mjs';

const finestreSu = (app, p) => app.evaluate(({ BrowserWindow }, x) => BrowserWindow.getAllWindows()
  .filter((w) => { try { return w.webContents.getURL().includes(x); } catch (_) { return false; } }).length, p);

test('«Apri» su una finestra di accesso bloccata la apre come finestra collegata al sito, dove l\'accesso può tornare', async ({ app, openTab, testServer, avvisi }) => {
  const accesso = `${testServer.html('<title>ACCESSO</title><script>document.title = window.opener ? "CON-OPENER" : "SENZA-OPENER"</script>')}?client_id=z&response_type=code`;
  await openTab(testServer.html(`<title>Sito</title><script>setTimeout(function(){window.open(${JSON.stringify(accesso)}, 'login', 'width=400,height=500')},2500)</script>`));
  const carta = (await avvisi()).locator('.shell-notif.show', { hasText: 'Bloccato popup' });
  await expect(carta).toBeVisible({ timeout: 10000 });
  await carta.locator('.shell-notif-action', { hasText: 'Apri' }).click();
  await expect.poll(() => finestreSu(app, 'client_id=z'), { timeout: 8000 }).toBe(1);
});
