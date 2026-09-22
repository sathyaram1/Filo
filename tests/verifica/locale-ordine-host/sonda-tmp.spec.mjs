// Sonda usa e getta (si cancella): alla chiusura di una scheda quali eventi
// arrivano alla pagina?

import { test, expect } from '../../fixtures/electron.mjs';

test('sonda: cosa arriva alla chiusura', async ({ shell, openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });

  await page.evaluate(() => {
    const segna = (nome) => { try { localStorage.setItem('sonda-' + nome, '1'); } catch (_) {} };
    for (const n of ['pagehide', 'beforeunload', 'unload', 'hidden']) {
      try { localStorage.removeItem('sonda-' + n); } catch (_) {}
    }
    window.addEventListener('pagehide', () => segna('pagehide'));
    window.addEventListener('beforeunload', () => segna('beforeunload'));
    window.addEventListener('unload', () => segna('unload'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') segna('hidden');
    });
  });

  const snap = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const lista = Array.isArray(s) ? s : (s && s.tabs) || [];
    return lista.map((t) => ({ id: t.id, url: t.url || '' }));
  });
  const pref = snap.find((t) => t.url.includes('preferences'));
  await shell.evaluate((id) => window.filoShell.tabs.close(id), pref.id);
  await new Promise((r) => setTimeout(r, 1500));

  const dopo = await openTab('filo://preferences/preferences.html');
  await dopo.waitForSelector('#agentStyleText', { timeout: 15_000 });
  const visti = await dopo.evaluate(() => ({
    pagehide: localStorage.getItem('sonda-pagehide'),
    beforeunload: localStorage.getItem('sonda-beforeunload'),
    unload: localStorage.getItem('sonda-unload'),
    hidden: localStorage.getItem('sonda-hidden'),
  }));
  expect(JSON.stringify(visti), 'SONDA').toBe('mai');
});
