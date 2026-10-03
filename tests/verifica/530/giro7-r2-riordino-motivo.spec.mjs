// Verifica #530, giro 7: dopo una lettura, il popup del riordino delle schede e quello dello svuotamento dell'archivio
// dicono il motivo in una frase, come ogni altra domanda della regola.
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmText, clickConfirm } from '../../helpers/confirm.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

test('chat a Normale dopo una ricerca: il popup del riordino dice perché chiede', async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_WEB_SEARCH.search = async () => ({ provider: 'finto', results: [
      { title: 'Meteo', url: 'https://meteo.test/', content: 'sole' },
    ] });
  });
  const page = await home(app);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'meteo' }) }] },
      { toolCalls: [{ id: 'p1', name: 'PULISCI_TAB', arguments: '{}' }] },
      { text: 'Fatto.' },
    ]);
    await chiedi(page, 'cerca il meteo e poi riordina le schede');
    const btn = page.locator('button', { hasText: 'Riordina e archivia le schede' });
    await expect(btn).toBeVisible({ timeout: 15000 });
    await btn.click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 8000 });
    const testo = await confirmText(page);
    await clickConfirm(page, 'cancel');
    expect(testo).toContain('ricerca sul web');
  } finally {
    await ripristina(app);
  }
});
