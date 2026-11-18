import { test, expect } from '../../fixtures/electron.mjs';

async function homePage(app) {
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 8_000 });
  return page;
}
async function vaiAllaHome(shell) {
  const s = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const h = s.tabs.find((t) => String(t.url || '').startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);
}
const registro = (app) => app.evaluate(() => globalThis.__filoAvvisoSistema.registroProva.map((r) => ({ titolo: r.titolo, testo: r.testo })));
const nellAngolo = (shell) => shell.locator('.shell-notif[data-luogo="angolo"]:not([data-closing="1"])');

test('ricarica con Filo davanti su un sito: il timer scaduto avvisa nell\'angolo a ricarica finita', async ({ app, shell, avvisi, testServer, openTab }) => {
  await testServer.openReady(openTab, '<h1>Un sito</h1>');
  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate(([t]) => window.filoShell.message({ type: t, label: 'Ricarica', seconds: 1 }), [tipo]);
  await shell.waitForTimeout(1300);
  const caricava = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.webContents.reload();
    const l = w.webContents.isLoading();
    await globalThis.__filoAlarmWatcher._tick();
    return l;
  });
  expect(caricava).toBe(true);
  let nuova = null;
  await expect.poll(async () => {
    for (const p of app.windows()) {
      try { if (p.url().includes('shell.html') && await p.locator('.shell-notif', { hasText: 'Ricarica' }).count()) { nuova = p; return true; } } catch (_) {}
    }
    return false;
  }, { timeout: 15_000 }).toBe(true);
  expect(await registro(app)).toEqual([]);
});

test('solo l\'incognito aperta, Filo non davanti: la finestra riaperta per il timer porta la notifica del sistema', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate((t) => window.filoShell.message({ type: t, label: 'Solo incognito', seconds: 8 }), tipo);
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.windows().some((p) => { try { return p.url().includes('incognito=1'); } catch (_) { return false; } }), { timeout: 20_000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).close(); });
  await app.evaluate(() => globalThis.__filoAvvisoSistema.impostaPerProva(false));
  await expect.poll(() => registro(app), { timeout: 40_000 }).toEqual([{ titolo: 'Filo', testo: 'Timer «Solo incognito» scaduto' }]);
});

test('sveglia scaduta su un sito, poi la home: l\'avviso lascia subito l\'angolo e la carta si fa notare', async ({ app, shell, avvisi, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>Un sito</h1>');
  const target = new Date(Date.now() + 2500);
  await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a, {}), { type: 'SVEGLIA', time: target.toISOString(), label: 'Riunione' });
  await shell.waitForTimeout(3000);
  await app.evaluate(async () => { await globalThis.__filoAlarmWatcher._tick(); });
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'Riunione' })).toBeVisible({ timeout: 8_000 });
  await vaiAllaHome(shell);
  const home = await homePage(app);
  await expect(home.locator('#accade > .dash-carta[data-chiave^="timer:"]')).toHaveClass(/dash-notare/, { timeout: 3_000 });
  await expect(nellAngolo(shell)).toHaveCount(0, { timeout: 1_500 });
  await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(0);
});

test('nella home un avviso con una carta che non c\'è (timer già tolto): resta visibile come carta, non sparisce', async ({ app, shell }) => {
  const home = await homePage(app);
  await shell.evaluate(() => window.filoNotify('Timer «Fantasma» scaduto', { durationSec: 0, carta: 'timer:nonesiste123' }));
  await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toContainText('Fantasma', { timeout: 8_000 });
});

test('carta dello scaricamento nascosta dall\'utente: il suo avviso nella home resta visibile', async ({ app, shell }) => {
  const home = await homePage(app);
  // Una carta di timer che c'è, poi nascosta dalla colonna.
  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate((t) => window.filoShell.message({ type: t, label: 'Lungo', seconds: 600 }), tipo);
  const carta = home.locator('#accade > .dash-carta[data-chiave^="timer:"]');
  await expect(carta).toHaveCount(1, { timeout: 8_000 });
  const chiave = await carta.getAttribute('data-chiave');
  await carta.click({ button: 'right' });
  const voci = await home.locator('.dash-menu .dash-menu-voce').allTextContents();
  const nascondi = voci.find((v) => /Nascondi|Togli dalla/i.test(v));
  test.skip(!nascondi, `nessuna voce per nascondere: ${voci.join(' | ')}`);
  await home.locator('.dash-menu .dash-menu-voce', { hasText: nascondi }).click();
  await expect(carta).toHaveCount(0, { timeout: 5_000 });
  await shell.evaluate((k) => window.filoNotify('Timer «Lungo» quasi finito', { durationSec: 0, carta: k }), chiave);
  await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toContainText('Lungo', { timeout: 8_000 });
});
