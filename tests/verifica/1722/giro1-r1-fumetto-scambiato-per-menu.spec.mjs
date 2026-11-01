// Verifica #1722 giro 1, rilievo 1: il fumetto nato all'avvio è una finestra «data:text/html» come il menu a comparsa,
// e le prove che cercano il menu per indirizzo prendono lui (menu-launcher-icons, manage-pagine-owner rossi; in-pausa e
// audit-notes-visibility a volte). Qui il passo comune: aperto il menu App, una sola finestra così, ed è il menu.
import { test, expect } from '../../fixtures/electron.mjs';

const finestreDati = (app) => app.windows().filter((w) => { try { return !w.isClosed() && w.url().startsWith('data:text/html'); } catch (_) { return false; } });

test('r1 aperto il menu App, la prima finestra del menu che una prova trova è il menu, non il fumetto', async ({ app, shell }) => {
  await shell.evaluate(() => document.getElementById('nav-apps').click());
  await expect.poll(async () => {
    const w = finestreDati(app)[0];
    return w ? w.locator('.item').count() : 0;
  }, { timeout: 5000 }).toBeGreaterThan(0);
  expect(finestreDati(app)).toHaveLength(1);
});
