// Il logo Filo (newTab) della barra laterale apre una nuova scheda (feedback
// alpha; da #1246 l'icona sta nella barra, non più in cima al tasto destro).

import { test, expect } from './fixtures/electron.mjs';
import { iconaDellaBarra } from './helpers/barra.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo test page</h1>
  <p>Una pagina qualsiasi.</p>
</body></html>`;

test('click sul logo Filo (newTab) apre una nuova tab', async ({ openTab, testServer, app }) => {
  const page = await testServer.openReady(openTab, HTML);
  const btn = await iconaDellaBarra(app, 'newTab');
  await expect(btn).toHaveAttribute('aria-label', 'Nuova scheda');
  await btn.click();

  // Polling: attendo che compaia una nuova window di Filo (la newtab), e il sito resta nella sua scheda.
  await expect.poll(() => app.windows().some((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } }),
    { timeout: 5_000, message: 'newtab non aperta dopo click sul logo Filo' }).toBe(true);
  expect(app.windows().some((w) => { try { return w.url() === page.url(); } catch (_) { return false; } })).toBe(true);
});
