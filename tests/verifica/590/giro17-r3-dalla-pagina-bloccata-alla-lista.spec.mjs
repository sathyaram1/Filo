// Giro 17 di #590, rilievo 3: la pagina «Sito bloccato» dice che il sito è nella lista ma non porta alla lista.
import { test, expect, lista, schede, apri, schedaSu } from '../../helpers/reteFinta.mjs';

const PAGINA_BLOCCATA = /^filo:\/\/error\/error\.html\?.*code=blocked/;

test('dalla pagina «Sito bloccato» si arriva alla lista dei siti bloccati', async ({ app, shell, rete }) => {
  await lista(shell, []);
  await apri(app, shell, rete.pagina('blocked.test', '/', '<h1>SITO</h1>'));
  await lista(shell, ['blocked.test']);
  await expect.poll(async () => ((await schedaSu(app, 'blocked.test')) || {}).caricata || '', { timeout: 6000 }).toMatch(PAGINA_BLOCCATA);
  const pagina = app.windows().find((w) => PAGINA_BLOCCATA.test(w.url()));
  const altre = pagina.locator('a:visible, button:visible').filter({ hasNotText: 'Apri comunque' });
  await expect(altre.first()).toBeVisible({ timeout: 2000 });
  await altre.first().click();
  await expect.poll(async () => (await schede(app)).some((u) => u.startsWith('filo://security')), { timeout: 6000 }).toBe(true);
});
