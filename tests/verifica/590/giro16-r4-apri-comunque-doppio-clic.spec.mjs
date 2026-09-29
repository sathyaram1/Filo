// Verifica #590 giro 16, rilievo 4: un doppio clic su «Apri comunque» della notifica non deve
// lasciare una pila di schede dello stesso sito.
import { test, expect, lista, schede } from '../../helpers/reteFinta.mjs';

test('doppio clic su «Apri comunque»: una scheda sola', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), sito);
  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first();
  await expect(card).toBeVisible({ timeout: 6000 });
  await card.locator('.shell-notif-action', { hasText: 'Apri comunque' }).dblclick();
  await expect.poll(async () => (await schede(app)).filter((u) => u.includes('blocked.test')).length, { timeout: 6000 }).toBeGreaterThan(0);
  await shell.waitForTimeout(1500);
  expect((await schede(app)).filter((u) => u.includes('blocked.test'))).toHaveLength(1);
});
