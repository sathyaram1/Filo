// Giro 6, rilievo 3: nell'elenco dei siti bloccati (un dominio per riga) la correzione automatica mette la maiuscola ai
// marchi: «facebook» seguito da Invio diventa «Facebook».
import { test, expect } from '../../fixtures/electron.mjs';

test('r3 nell\'elenco dei siti bloccati quello che si scrive resta com\'è', async ({ shell, openTab }) => {
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { security: { siteBlock: { enabled: true, blacklist: [] } } },
  }));
  const page = await openTab('filo://security/security.html');
  const lista = page.locator('#sec-siteblock-blacklist');
  await expect(lista).toBeEnabled({ timeout: 8000 });
  await lista.click();
  await page.keyboard.type('facebook\nyoutube\nresta.it');
  await expect(lista).toHaveValue('facebook\nyoutube\nresta.it');
});
