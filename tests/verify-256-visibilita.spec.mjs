// Sonda: quando l'utente cambia scheda, la pagina Sicurezza riceve davvero
// l'evento di "torno visibile" su cui poggia l'aggiornamento della cronologia
// appunti? Registra gli eventi invece di dedurli.

import { test, expect } from './fixtures/electron.mjs';

test('#256 sonda visibilitychange sulle schede', async ({ app, shell, openTab, testServer }) => {
  const pagina = await openTab('filo://security/');
  await expect(pagina.locator('#sec-clip-desc')).toBeVisible({ timeout: 10_000 });
  await pagina.evaluate(() => {
    window.__vis = [document.visibilityState];
    document.addEventListener('visibilitychange', () => window.__vis.push(document.visibilityState));
  });

  const web = await testServer.openReady(
    openTab,
    '<!doctype html><html><body style="padding:40px"><p>altra scheda</p></body></html>',
  );
  await pagina.waitForTimeout(800);
  console.log('[#256] dopo apertura altra scheda:', JSON.stringify(await pagina.evaluate(() => window.__vis)));

  const ids = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const list = Array.isArray(snap) ? snap : (snap.tabs || []);
    return list.map((t) => ({ id: t.id, url: t.url }));
  });
  const sec = ids.find((t) => String(t.url).includes('security'));
  const altro = ids.find((t) => String(t.url).includes('127.0.0.1'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), altro.id);
  await pagina.waitForTimeout(600);
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), sec.id);
  await pagina.waitForTimeout(1000);
  const eventi = await pagina.evaluate(() => window.__vis);
  console.log('[#256] serie visibilityState:', JSON.stringify(eventi));
  console.log('[#256] hidden ora:', await pagina.evaluate(() => document.hidden));
  void web;
});
