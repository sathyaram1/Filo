// #2031 giro 2 — con la sola finestra ridotta a icona, le voci della barra non agiscono su schede che non si vedono.

import { test, expect } from '../../fixtures/electron.mjs';
import { voceDellaBarra } from '../../helpers/barraDeiMenu.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
  return { ridotta: w.isMinimized(), schede: w._filoTabs.tabs.map((t) => t.url || '') };
});

test('r2 finestra ridotta a icona: «Chiudi scheda» non chiude una scheda che non si vede', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>Lettera</title><h1>lettera a metà</h1>');
  const lettera = page.url();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.minimize();
  });
  await expect.poll(async () => (await schede(app)).ridotta, { message: 'in questo ambiente la finestra non si riduce', timeout: 5000 }).toBe(true);
  await voceDellaBarra(app, 'Chiudi scheda');
  await new Promise((r) => setTimeout(r, 800));
  const s = await schede(app);
  // Chiusa senza vederla, l'utente non sa nemmeno di averla persa; riportata davanti, la vede e decide lui.
  expect(s.ridotta && !s.schede.includes(lettera), 'la scheda è sparita da una finestra ridotta, senza che l\'utente la vedesse').toBe(false);
});
