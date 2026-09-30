// Giro 17 di #590, rilievo 2: dopo un'apertura del modello fermata dalla lista, «Apri comunque» vive solo
// nella notifica, che se ne va prima che l'utente legga la risposta che gliela indica.
import { test, expect, lista, schede } from '../../helpers/reteFinta.mjs';
import { home, modelloFinto, ripristina, chiedi } from './helpers/modello17.mjs';

test('NAVIGA fermata dalla lista: letta la risposta, «Apri comunque» è ancora a portata e apre il sito', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: bersaglio, etichetta: 'pagina' }) }] },
    // La risposta di un modello vero, dopo il risultato dell'azione, arriva dopo qualche secondo.
    { ritardoMs: 3000, text: 'Non l’ho aperta: è fra i siti che hai bloccato. Se vuoi aprirla lo stesso c’è «Apri comunque» nella notifica.' },
  ]);
  try {
    await chiedi(page, 'apri quella pagina');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Non l’ho aperta' })).toBeVisible({ timeout: 20_000 });
    // Il tempo di leggere la risposta.
    await page.waitForTimeout(3000);
    const nellaNotifica = shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).locator('.shell-notif-action', { hasText: 'Apri comunque' });
    const inChat = page.getByText('Apri comunque', { exact: true });
    const quale = (await nellaNotifica.count()) ? nellaNotifica.first() : inChat.first();
    await expect(quale).toBeVisible({ timeout: 2000 });
    await quale.click();
    await expect.poll(async () => (await schede(app)).some((u) => u.includes('blocked.test')), { timeout: 8000 }).toBe(true);
  } finally {
    await ripristina(app);
  }
});
