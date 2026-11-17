// #2390 — Un avviso solo, con la forma che dice dove sta l'utente: notifica del sistema con Filo non davanti, l'angolo
// in basso a destra su una pagina, nella home la carta che c'è già o il volo nella colonna di sinistra.

import { test, expect } from './fixtures/electron.mjs';

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

const registro = (app) => app.evaluate(() => globalThis.__filoAvvisoSistema.registroProva
  .map((r) => ({ titolo: r.titolo, testo: r.testo, chiusa: r.chiusa })));

async function timerScaduto(app, shell, etichetta) {
  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate(([t, l]) => window.filoShell.message({ type: t, label: l, seconds: 1 }), [tipo, etichetta]);
  await shell.waitForTimeout(1300);
  await app.evaluate(async () => { await globalThis.__filoAlarmWatcher._tick(); });
}

test('timer scaduto con Filo davanti su un sito: l\'avviso di Filo in basso a destra, con icona e «Ferma»; nessuna notifica del sistema', async ({ app, shell, avvisi, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>Un sito</h1>');
  await timerScaduto(app, shell, 'Pasta');
  const vista = await avvisi();
  const carta = vista.locator('.shell-notif.show', { hasText: 'Timer «Pasta» scaduto' });
  await expect(carta).toBeVisible({ timeout: 8_000 });
  await expect(carta.locator('.shell-notif-ico svg')).toHaveCount(1);
  expect(await registro(app)).toEqual([]);
  await expect(shell.locator('#ring-indicator')).toBeVisible();

  await carta.locator('.shell-notif-action', { hasText: 'Ferma' }).click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 5_000 });
  await expect(vista.locator('.shell-notif.show')).toHaveCount(0, { timeout: 5_000 });
});

test('timer scaduto con la home davanti: nessun avviso, la carta del timer si fa notare e suona', async ({ app, shell }) => {
  const home = await homePage(app);
  await timerScaduto(app, shell, 'Uova');
  const carta = home.locator('#accade > .dash-carta[data-chiave^="timer:"]');
  await expect(carta).toHaveClass(/dash-notare/, { timeout: 5_000 });
  await expect(carta).toHaveAttribute('data-suona', '1');
  expect(await shell.evaluate(() => window.SN_SOUNDS.isRinging())).toBe(true);
  await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(0);
  await expect(shell.locator('.shell-notif:not([data-closing="1"])')).toHaveCount(0, { timeout: 5_000 });
  expect(await registro(app)).toEqual([]);
});

test('timer scaduto con Filo non davanti: notifica del sistema col nome di Filo; il clic riporta l\'avviso in Filo, «Ferma» la toglie', async ({ app, shell }) => {
  const home = await homePage(app);
  await app.evaluate(() => globalThis.__filoAvvisoSistema.impostaPerProva(false));
  await shell.waitForTimeout(200);
  await timerScaduto(app, shell, 'Tè');
  await expect.poll(() => registro(app)).toEqual([{ titolo: 'Filo', testo: 'Timer «Tè» scaduto', chiusa: false }]);
  // Dentro Filo niente: né nell'angolo né nella colonna.
  await expect(shell.locator('.shell-notif:not([data-luogo="fuori"])')).toHaveCount(0);
  await expect(home.locator('#accade > .dash-carta.dash-notare')).toHaveCount(0);

  await app.evaluate(() => { globalThis.__filoAvvisoSistema.impostaPerProva(true); globalThis.__filoAvvisoSistema.registroProva[0].clic(); });
  await expect(home.locator('#accade > .dash-carta[data-chiave^="timer:"]')).toHaveClass(/dash-notare/, { timeout: 5_000 });

  await home.locator('#accade > .dash-carta[data-chiave^="timer:"] .dash-carta-az', { hasText: 'Ferma' }).click();
  await expect.poll(() => registro(app), { timeout: 8_000 }).toEqual([{ titolo: 'Filo', testo: 'Timer «Tè» scaduto', chiusa: true }]);
});

test('Filo non davanti in incognito: nessuna notifica del sistema, l\'avviso resta nella finestra', async ({ app, shell }) => {
  // Lo stesso controllo del main che rifiuta l'incognito: una finestra senza permesso non lascia tracce nel sistema.
  await app.evaluate(() => globalThis.__filoAvvisoSistema.impostaPerProva(false));
  const ok = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const prima = w._filoIncognito;
    w._filoIncognito = true;
    const r = globalThis.__filoAvvisoSistema.mostra(w, { uid: 'prova-incognito', testo: 'segreto' });
    w._filoIncognito = prima;
    return r;
  });
  expect(ok).toBe(false);
  expect(await registro(app)).toEqual([]);
  await app.evaluate(() => globalThis.__filoAvvisoSistema.impostaPerProva(true));
  await shell.evaluate(() => window.filoNotify('Avviso qualunque', { durationSec: 0 }));
  await expect(shell.locator('.shell-notif[data-luogo="fuori"]')).toHaveCount(0);
});

test('nella home un avviso senza carta: angolo, poi volo in cima alla colonna; azioni e tasto destro uguali; il campo non cambia mai larghezza', async ({ app, shell, avvisi }) => {
  const home = await homePage(app);
  // Il campo misurato a ogni fotogramma, da prima dell'avviso a dopo il volo.
  await home.evaluate(() => {
    window.__larghezze = new Set();
    const f = document.getElementById('inputForm');
    const giro = () => { window.__larghezze.add(Math.round(f.getBoundingClientRect().width)); window.__giro = requestAnimationFrame(giro); };
    giro();
  });
  await shell.evaluate(() => window.filoNotify('Errore di prova: la pagina non si apre', {
    durationSec: 1, actions: [{ label: 'Riprova', onClick() { window.__riprovato = (window.__riprovato || 0) + 1; } }],
  }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'Errore di prova' })).toBeVisible();

  const carta = home.locator('#accade > .dash-carta[data-tipo="cornice"]');
  await expect(carta).toHaveCount(1, { timeout: 6_000 });
  await expect(home.locator('#accade > .dash-carta').first()).toHaveAttribute('data-tipo', 'cornice');
  await expect(carta).toContainText('Errore di prova: la pagina non si apre');
  await expect(vista.locator('.shell-notif.show')).toHaveCount(0);
  // Il volo è finito: la carta vera è a posto e la copia non c'è più.
  await expect(home.locator('.dash-carta-in-volo')).toHaveCount(0, { timeout: 3_000 });
  await home.waitForTimeout(300);
  const larghezze = await home.evaluate(() => { cancelAnimationFrame(window.__giro); return [...window.__larghezze]; });
  expect(larghezze).toHaveLength(1);

  await carta.click({ button: 'right' });
  const menu = home.locator('.dash-menu');
  await expect(menu.locator('.dash-menu-voce', { hasText: 'Riprova' })).toBeVisible();
  await expect(menu.locator('.dash-menu-voce', { hasText: 'Chiudi l’avviso' })).toBeVisible();
  await menu.locator('.dash-menu-voce', { hasText: 'Riprova' }).click();
  await expect.poll(() => shell.evaluate(() => window.__riprovato)).toBe(1);
  await expect(carta).toHaveCount(0, { timeout: 5_000 });

  // Chiudere la carta chiude l'avviso.
  await shell.evaluate(() => window.filoNotify('Secondo avviso', { durationSec: 1 }));
  await expect(carta).toHaveCount(1, { timeout: 6_000 });
  await carta.locator('.dash-carta-togli').click();
  await expect(carta).toHaveCount(0, { timeout: 5_000 });
  await expect(shell.locator('.shell-notif:not([data-closing="1"])')).toHaveCount(0);
});

test('nella home il volo aspetta finché il puntatore sta sull\'avviso', async ({ app, shell, avvisi }) => {
  const home = await homePage(app);
  await shell.evaluate(() => window.filoNotify('Aspetta che lo legga', { durationSec: 1 }));
  const vista = await avvisi();
  const inAngolo = vista.locator('.shell-notif.show', { hasText: 'Aspetta che lo legga' });
  await expect(inAngolo).toBeVisible();
  await inAngolo.hover();
  await vista.waitForTimeout(2500);
  await expect(inAngolo).toBeVisible();
  await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(0);
  await vista.mouse.move(1, 1);
  await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(1, { timeout: 6_000 });
});

test('con la riduzione del movimento la carta compare subito nella colonna, senza passare dall\'angolo', async ({ app, shell }) => {
  const home = await homePage(app);
  await shell.emulateMedia({ reducedMotion: 'reduce' });
  await home.emulateMedia({ reducedMotion: 'reduce' });
  await shell.evaluate(() => window.filoNotify('Diretto nella colonna'));
  await expect(shell.locator('.shell-notif').first()).toHaveAttribute('data-luogo', 'colonna');
  await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toContainText('Diretto nella colonna', { timeout: 2_000 });
  await expect(home.locator('.dash-carta-in-volo')).toHaveCount(0);
});

test('su un sito l\'avviso resta nell\'angolo e se ne va: non diventa una carta; tornando alla home non resta nell\'angolo', async ({ app, shell, avvisi, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>Un sito</h1>');
  await shell.evaluate(() => window.filoNotify('Breve, su un sito', { durationSec: 1 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'Breve, su un sito' })).toBeVisible();
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 6_000 });

  // Un avviso che resta finché lo si chiude: su un sito resta, arrivati nella home vola dopo il tempo di leggerlo.
  await shell.evaluate(() => window.filoNotify('Resta finché lo chiudi', { durationSec: 0 }));
  await expect(vista.locator('.shell-notif.show', { hasText: 'Resta finché lo chiudi' })).toBeVisible();
  await shell.waitForTimeout(1500);
  await expect(vista.locator('.shell-notif.show', { hasText: 'Resta finché lo chiudi' })).toBeVisible();
  await vaiAllaHome(shell);
  const home = await homePage(app);
  await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toContainText('Resta finché lo chiudi', { timeout: 9_000 });
  await expect(vista.locator('.shell-notif.show')).toHaveCount(0);
});

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}: l'avviso nell'angolo con icona e la carta volata nella home`, async ({ app, shell, avvisi, openTab, testServer }) => {
    await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t; }, tema);
    const home = await homePage(app);
    await shell.evaluate(() => window.filoNotify('Non sono riuscito ad aprire il file: forse è stato spostato', {
      durationSec: 1, errore: true, actions: [{ label: 'Apri cartella', onClick() {} }],
    }));
    await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(1, { timeout: 6_000 });
    await expect(home.locator('.dash-carta-in-volo')).toHaveCount(0, { timeout: 3_000 });
    await home.screenshot({ path: `tests/.shots/2390-home-carta-${tema}.png` });

    await testServer.openReady(openTab, '<h1>Un sito</h1><p>Una pagina qualunque.</p>');
    await shell.evaluate(() => window.filoNotify('Scaricato: relazione.pdf', { durationSec: 0, carta: 'download:abc', actions: [{ label: 'Apri file', onClick() {} }] }));
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show .shell-notif-ico svg')).toHaveCount(1);
    await vista.waitForTimeout(400);
    await vista.screenshot({ path: `tests/.shots/2390-angolo-${tema}.png` });
  });
}
