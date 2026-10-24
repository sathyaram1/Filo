// #480 — Le pagine che aprono tanti popup insieme: gli avvisi «Bloccato popup da…» a schermo restano pochi, dentro
// l'area della pagina e chiudibili; quelli oltre il tetto aspettano dietro il «+N» (#1477).
// Regole: patterns/stack-di-overlay-impilati-limita-il-numero-e-non-superare.md

import { test, expect } from './fixtures/electron.mjs';

const finestraBassa = (app) => app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows().find((w) => w._filoTabs).setContentSize(760, 520);
});
const posa = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  const [W, H] = win.getContentSize();
  const indirizzo = (t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } };
  const pubblicita = win._filoTabs.tabs.filter((t) => /[?&]ad=/.test(indirizzo(t))).length;
  return { b: win._filoTabs.avvisi.vista.getBounds(), W, H, alto: win._filoTabs._altezzaCornice(), pubblicita };
});
// Ogni pagina, al momento fissato, apre in un colpo solo `n` finestre pubblicitarie diverse: nessun gesto dell'utente.
const raffica = (testServer, quando, n, titolo = 'Sito') => testServer.html(`<title>${titolo}</title><p>articolo</p><script>
  setTimeout(function(){for(var i=0;i<${n};i++)window.open('${testServer.html('<title>PUBBLICITA</title>')}?ad='+i)}, Math.max(300, ${quando}-Date.now()));
</script>`);

test('una pagina che apre trenta popup insieme ha un avviso solo, in vista, e la X lo chiude', async ({ app, shell, openTab, testServer, avvisi }) => {
  await finestraBassa(app);
  await openTab(raffica(testServer, Date.now() + 1200, 30));
  const vista = await avvisi();
  const carta = vista.locator('.shell-notif.show', { hasText: 'Bloccato popup da 127.0.0.1' });
  await expect(carta).toBeVisible({ timeout: 8000 });
  await shell.waitForTimeout(800);
  await expect(vista.locator('.shell-notif')).toHaveCount(1);
  expect((await posa(app)).pubblicita, 'nessuna scheda pubblicitaria aperta').toBe(0);

  await expect(carta.locator('.shell-notif-close')).toBeInViewport();
  await carta.locator('.shell-notif-close').click();
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
});

test('dieci schede che aprono popup tutte insieme in una finestra bassa: pochi avvisi, dentro la pagina, tutti chiudibili', async ({ app, shell, testServer, avvisi }) => {
  // Avvisi che restano finché l'utente non li chiude: il caso in cui una pila senza tetto cresce di più.
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { notifications: { durationSec: 0, soundEnabled: false, sound: 'default' } },
  }));
  await finestraBassa(app);
  const quando = Date.now() + 7000;
  for (let i = 0; i < 10; i++) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), raffica(testServer, quando, 12, `Sito ${i}`));
  }
  const vista = await avvisi();
  const altre = vista.locator('.avvisi-testa [data-pila="apri"]');
  await expect(vista.locator('.shell-notif.show', { hasText: 'Bloccato popup' })).toHaveCount(5, { timeout: 15000 });
  await expect(altre, 'le cinque oltre il tetto non si perdono').toHaveText('+5 avvisi', { timeout: 15000 });
  await shell.waitForTimeout(1500);
  await expect(vista.locator('.shell-notif'), 'il tetto tiene anche a raffica finita').toHaveCount(5);
  await expect(altre).toHaveText('+5 avvisi');
  await expect(shell.locator('.shell-notif'), 'un avviso per scheda').toHaveCount(10);

  // La vista sta sotto la barra e dentro la finestra, larga quanto le carte: il resto del lato destro è della pagina.
  await expect.poll(async () => (await posa(app)).b.height).toBeGreaterThan(0);
  const p = await posa(app);
  expect(p.b.y).toBeGreaterThanOrEqual(p.alto);
  expect(p.b.y + p.b.height).toBeLessThanOrEqual(p.H);
  expect(p.b.x + p.b.width).toBeLessThanOrEqual(p.W);
  expect(p.b.width).toBeLessThanOrEqual(400);

  // La più recente è in vista con la sua X, e il «+N» si raggiunge scorrendo.
  await expect(vista.locator('.shell-notif').last().locator('.shell-notif-close')).toBeInViewport();
  await altre.scrollIntoViewIfNeeded();
  await expect(altre).toBeInViewport();

  // Tutte e dieci si chiudono con la loro X: chiusa una a schermo, entra una di quelle che aspettavano.
  for (let resto = 10; resto > 0; resto--) {
    const nid = await vista.locator('.shell-notif.show').first().getAttribute('data-nid');
    const x = vista.locator(`.shell-notif[data-nid="${nid}"] .shell-notif-close`);
    await x.scrollIntoViewIfNeeded();
    await expect(x).toBeInViewport();
    await x.click();
    await expect(shell.locator('.shell-notif:not([data-closing="1"])')).toHaveCount(resto - 1, { timeout: 4000 });
    // La chiusura torna alla pila disegnata con un viaggio in più: senza aspettarla si riclicca la carta che sparisce.
    await expect(vista.locator(`.shell-notif.show[data-nid="${nid}"]`)).toHaveCount(0, { timeout: 4000 });
    await expect(vista.locator('.shell-notif.show')).toHaveCount(Math.min(5, resto - 1), { timeout: 4000 });
    const fuori = resto - 1 - 5;
    if (fuori > 0) await expect(altre).toHaveText(`+${fuori} ${fuori === 1 ? 'avviso' : 'avvisi'}`);
    else await expect(vista.locator('.avvisi-testa')).toBeHidden();
  }
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
});
