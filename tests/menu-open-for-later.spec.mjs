// Feedback #252 — "Aperti per dopo" deve essere RAGGIUNGIBILE da un ingresso
// stabile della GUI, non solo digitando l'indirizzo. L'icona dedicata del menu
// del tasto destro è stata ritirata e l'icona Home porta alla nuova scheda: la
// lista di ciò che hai messo da parte con "Salva per dopo" (che per giunta
// chiude la scheda) restava senza porta d'ingresso, mentre il manifesto delle
// capacità continuava a indicarne una che non esiste più.
//
// Qui verifichiamo il SUCCESSO del flusso, non l'assenza di un errore: apro il
// menu App, clicco "Aperti per dopo" e la scheda della lista si apre davvero.
// Senza la voce nel launcher il click non esiste → il test è rosso.

import { test, expect } from './fixtures/electron.mjs';

async function openAppMenu(app, shell) {
  await shell.evaluate(() => document.getElementById('nav-apps')?.click());
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const w = app.windows().find((p) => p.url().startsWith('data:text/html'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error('menu App non aperto');
}

test('dal menu App si arriva davvero alla lista "Aperti per dopo"', async ({ app, shell }) => {
  const menu = await openAppMenu(app, shell);

  const voce = menu.locator('.menu .item', { hasText: 'Aperti per dopo' });
  await expect(voce, 'la voce "Aperti per dopo" manca nel menu App').toHaveCount(1);
  // Ogni voce del launcher ha la sua icona (qui il segnalibro di "salva per dopo").
  await expect(voce.locator('.ico svg')).toHaveCount(1);

  try { await menu.screenshot({ path: 'tests/.shots/menu-open-for-later-252.png' }); } catch (_) {}

  await voce.click();

  // Successo = la scheda con la lista è aperta davvero.
  const deadline = Date.now() + 8000;
  let urls = [];
  let ok = false;
  while (Date.now() < deadline) {
    urls = app.windows().map((w) => { try { return w.url(); } catch (_) { return ''; } });
    if (urls.some((u) => u.startsWith('filo://home/home.html'))) { ok = true; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(ok, `atteso un tab su filo://home/home.html. Finestre viste: ${JSON.stringify(urls)}`).toBe(true);

  // E la pagina è proprio "Aperti per dopo" (titolo dalla i18n), non una pagina qualsiasi.
  const page = app.windows().find((w) => { try { return w.url().startsWith('filo://home/home.html'); } catch (_) { return false; } });
  await page.waitForLoadState('domcontentloaded');
  await expect.poll(() => page.locator('#title').innerText(), { timeout: 8000 })
    .toContain('Aperti per dopo');
});
