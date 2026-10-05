// Verifica #755 giro 1, rilievo 1: un lettore che la pagina comanda (enablejsapi=1) esce ancora verso youtube.com coi cookie.
// Rosso finché l'owner non sceglie: se tiene l'eccezione, la prova si toglie.

import { test, expect } from '../../fixtures/electron.mjs';

test('Automatico: anche il lettore comandato dalla pagina esce verso nocookie', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ session }) => {
    globalThis.__reg755 = [];
    const fine = (d) => { if (d.resourceType === 'subFrame') globalThis.__reg755.push(d.url); };
    session.defaultSession.webRequest.onCompleted(fine);
    session.defaultSession.webRequest.onErrorOccurred(fine);
  });
  const url = testServer.html(`<title>API</title>
    <iframe src="https://www.youtube.com/embed/DDD444?enablejsapi=1&start=12" allowfullscreen></iframe>`);
  await openTab(url);
  await expect.poll(() => app.evaluate(() => globalThis.__reg755.length), { timeout: 15_000 }).toBeGreaterThan(0);
  const usciti = await app.evaluate(() => globalThis.__reg755);
  expect(usciti.filter((u) => /youtube\.com\/embed/i.test(u))).toEqual([]);
});
