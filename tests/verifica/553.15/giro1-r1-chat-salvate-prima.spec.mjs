// Verifica #553.15 giro 1: la home chiesta dalla home, riletta, si racconta come dal vivo anche nelle conversazioni
// salvate dalla versione precedente (esito «fallito» senza il segno della mossa senza effetto).
import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('r1 la home chiesta dalla home in una chat salvata dalla versione di prima, riaperta, non mostra l’avviso di un comando fallito', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await newtabPage(app);
  // Come la salvava la versione uscita con #553.14: esito fallito, il perché è la frase della diretta.
  const id = 'chat-home-vecchia';
  await app.evaluate(async (_e, chatId) => {
    await globalThis.SN_FILO_CHATS.append(chatId, { role: 'user', text: 'portami alla home' });
    await globalThis.SN_FILO_CHATS.append(chatId, {
      role: 'filo', text: 'Sei già qui, nella home.',
      esiti: [{ type: 'COMANDO_FINESTRA', esito: 'fallito', riga: 'Aprire la home di Filo', motivo: 'Sei già nella home' }],
    });
  }, id);
  const riaperta = await openTab(`filo://dashboard/dashboard.html?chat=${id}`);
  const bolla = riaperta.locator('.dash-bubble-filo', { hasText: 'Sei già qui' });
  await expect(bolla).toBeVisible({ timeout: 10_000 });
  const riga = bolla.locator('.dash-activity-row', { hasText: 'Sei già nella home' });
  await expect(riga).toHaveCount(1);
  await riaperta.screenshot({ path: 'tests/.shots/verifica-553.15-chat-vecchia.png' });
  expect(await riga.locator('.dash-activity-row-icon').textContent()).toBe('🏠');
  await expect(riga).not.toContainText(/non eseguito|non riuscit|⚠/i);
});
