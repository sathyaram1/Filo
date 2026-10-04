// #737.1 giro 4, rilievo 2: l'avviso della posta fermata dice «popup da mailto:…» invece del sito e della posta.
import { test, expect } from '../../fixtures/electron.mjs';

test('l\'avviso della posta aperta da sola dice che sito ci ha provato, non l\'indirizzo come se fosse un sito', async ({ app, openTab, testServer, avvisi }) => {
  await app.evaluate(({ shell }) => { shell.openExternal = async () => {}; });
  await openTab(testServer.html("<title>Sito</title><p>x</p><script>setTimeout(function(){window.open('mailto:a@b.it')},800)</script>"));
  const carta = (await avvisi()).locator('.shell-notif.show', { hasText: 'Bloccat' });
  await expect(carta).toBeVisible({ timeout: 8000 });
  const testo = await carta.innerText();
  expect(testo).toContain('127.0.0.1');
  expect(testo).not.toContain('mailto:');
});
