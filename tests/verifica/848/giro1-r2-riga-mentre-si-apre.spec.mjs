// #848 giro 1, rilievo 2: la riga di chat disegnata mentre la scheda del sito si sta aprendo resta senza icona
// se il sito non ha /favicon.ico, anche quando la scheda poco dopo ha la sua icona.

import { test, expect } from '../../fixtures/electron.mjs';

const BLU = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQCDgBAAHkAUEYgvCnAAAAAElFTkSuQmCC';

test('r2 la riga di chat di un sito aperto in quel momento prende l\'icona che la scheda ha appena trovato', async ({ app, openTab }) => {
  await app.evaluate(({ session, net }, blu) => {
    session.defaultSession.protocol.handle('https', (req) => {
      const u = new URL(req.url);
      if (u.hostname !== 'lento.test') return net.fetch(req, { bypassCustomProtocolHandlers: true });
      if (u.pathname === '/icona.png') return new Response(Buffer.from(blu, 'base64'), { headers: { 'content-type': 'image/png' } });
      if (u.pathname === '/favicon.ico') return new Response('no', { status: 404 });
      // La pagina arriva dopo un attimo, come un sito vero: la riga della chat è già disegnata.
      return new Promise((ok) => setTimeout(() => ok(new Response(
        '<!doctype html><html><head><meta charset="utf-8"><title>Lento</title><link rel="icon" href="/icona.png"></head><body>s</body></html>',
        { headers: { 'content-type': 'text/html; charset=utf-8' } })), 800));
    });
  }, BLU);
  const home = await openTab('filo://newtab/');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.openTab('https://lento.test/p', { activate: false });
  });
  await home.evaluate(() => {
    const h = document.createElement('div');
    h.id = 'riga-lenta';
    document.body.appendChild(h);
    window.__filoDashActions.renderActions(h, [{ type: 'NAVIGA', url: 'https://lento.test/p' }]);
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return (w._filoTabs.tabs.find((t) => /lento\.test/.test(t.url || '')) || {}).favicon || '';
  }), { timeout: 15000 }).toBe(`data:image/png;base64,${BLU}`);
  await expect(home.locator('#riga-lenta .dash-action-link-chip img')).toHaveAttribute('src', `data:image/png;base64,${BLU}`, { timeout: 10000 });
});
