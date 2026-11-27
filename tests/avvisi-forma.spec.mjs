// #2390 — Un avviso solo, con la forma che dice dove sta l'utente: notifica del sistema con Filo non davanti, l'angolo
// in basso a destra su una pagina, nella home la carta che c'è già o il volo nella colonna di sinistra.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { modelloFinto, chiedi, chiamateAlModello } from './helpers/chatFinta.mjs';

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
    window.__giro = setInterval(() => window.__larghezze.add(Math.round(f.getBoundingClientRect().width)), 30);
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
  const larghezze = await home.evaluate(() => { clearInterval(window.__giro); return [...window.__larghezze]; });
  expect(larghezze).toHaveLength(1);

  await carta.click({ button: 'right' });
  // Le voci dell'angolo, una chiusura sola; in più quello che ogni carta della home sa fare. A icone (#2555): ogni
  // icona seguita dalle varianti del suo verbo.
  const menu = menuDi(home);
  await expect(menu.principale).toBeVisible();
  expect(await menu.vociScritte()).toEqual(['Riprova', 'Chiudi', 'Apri nel filo']);
  await menu.scegli('Riprova');
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

  // Più avvisi nella colonna si tolgono anche tutti insieme, dal tasto destro di uno.
  await shell.evaluate(() => window.filoNotify('Secondo nella colonna'));
  const carte = home.locator('#accade > .dash-carta[data-tipo="cornice"]');
  await expect(carte).toHaveCount(2);
  await expect(carte.first()).toContainText('Secondo nella colonna');
  await carte.first().click({ button: 'right' });
  await home.locator('.dash-menu .dash-menu-voce', { hasText: 'Chiudi tutti' }).click();
  await expect(carte).toHaveCount(0, { timeout: 5_000 });
  await expect(shell.locator('.shell-notif:not([data-closing="1"])')).toHaveCount(0);
});

// #2570 — la segnalazione automatica parte quando il suo avviso se ne va: nella colonna non se ne andrebbe mai.
for (const ridotto of [false, true]) {
  test(`nella home un avviso a tempo di cui si aspetta l'uscita resta nell'angolo e alla scadenza se ne va${ridotto ? ' (movimento ridotto)' : ''}`, async ({ app, shell, avvisi }) => {
    const home = await homePage(app);
    if (ridotto) { await shell.emulateMedia({ reducedMotion: 'reduce' }); await home.emulateMedia({ reducedMotion: 'reduce' }); }
    await shell.evaluate(() => {
      window.__uscite = 0;
      window.filoNotify('L\'ho segnalato a chi sviluppa Filo', { durationSec: 1, alChiudere() { window.__uscite += 1; } });
    });
    await expect(shell.locator('.shell-notif', { hasText: 'L\'ho segnalato' })).toHaveAttribute('data-luogo', 'angolo');
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show', { hasText: 'L\'ho segnalato' })).toBeVisible();
    await expect.poll(() => shell.evaluate(() => window.__uscite), { timeout: 6_000 }).toBe(1);
    await expect(shell.locator('.shell-notif:not([data-closing="1"])')).toHaveCount(0);
    await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(0);
  });
}

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

// #2390.1 — le strade rimaste scoperte nel primo giro.

// Uno scaricamento che si comanda dalla prova: parte, poi finisce o si rompe quando lo dice lei.
async function scaricamentoComandato(nome) {
  const TOT = 4 * 1024 * 1024;
  const PRIMO = 64 * 1024;
  let res = null;
  let rotto = false;
  const srv = createServer((req, r) => {
    // Rotto resta rotto: la ripresa automatica di Chromium non deve ritrovare il file.
    if (rotto) { r.destroy(); return; }
    r.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': TOT, 'Content-Disposition': `attachment; filename="${nome}"` });
    r.write(Buffer.alloc(PRIMO, 1));
    res = r;
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${srv.address().port}/${nome}`,
    finisci() { res.end(Buffer.alloc(TOT - PRIMO, 1)); },
    rompi() { rotto = true; res.destroy(); },
    async chiudi() {
      try { res && !res.destroyed && res.destroy(); } catch (_) {}
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}
const statoScaricamento = async (shell, nome) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return (((r && r.items) || []).find((it) => it.filename === nome) || {}).state ?? null;
};
const nellAngolo = (shell) => shell.locator('.shell-notif[data-luogo="angolo"]:not([data-closing="1"])');

test('timer scaduto su un sito, poi la home: la carta del timer c\'è già, l\'avviso lascia subito l\'angolo', async ({ app, shell, avvisi, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>Un sito</h1>');
  await timerScaduto(app, shell, 'Riso');
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'Timer «Riso» scaduto' })).toBeVisible({ timeout: 8_000 });

  await vaiAllaHome(shell);
  const home = await homePage(app);
  const carta = home.locator('#accade > .dash-carta[data-chiave^="timer:"]');
  await expect(carta).toHaveClass(/dash-notare/, { timeout: 3_000 });
  // Il tempo di disegnare la home, non i cinque secondi di lettura di un avviso.
  await expect(nellAngolo(shell)).toHaveCount(0, { timeout: 1_500 });
  await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(0);
});

for (const fine of ['finito', 'non riuscito']) {
  test(`scaricamento da un sito, poi la home: niente carta in più, e ${fine} con la home davanti si fa notare la sua`, async ({ app, shell, avvisi, openTab, testServer }) => {
    test.setTimeout(120_000);
    const nome = fine === 'finito' ? 'grosso.bin' : 'rotto.bin';
    const s = await scaricamentoComandato(nome);
    try {
      const page = await testServer.openReady(openTab, `<a id="f" href="${s.url}">Scarica</a>`);
      await page.locator('#f').click();
      await expect.poll(() => statoScaricamento(shell, nome), { timeout: 20_000 }).toBe('progressing');
      const vista = await avvisi();
      await expect(vista.locator('.shell-notif-msg', { hasText: `Scaricamento avviato: ${nome}` })).toBeVisible({ timeout: 10_000 });

      await vaiAllaHome(shell);
      const home = await homePage(app);
      const carta = home.locator('#accade > .dash-carta[data-tipo="download"]', { hasText: nome });
      await expect(carta).toHaveClass(/dash-notare/, { timeout: 5_000 });
      await expect(nellAngolo(shell)).toHaveCount(0, { timeout: 1_500 });
      // Oltre i cinque secondi dell'avviso di via: se volasse nella colonna, adesso ci sarebbe.
      await home.waitForTimeout(6_000);
      await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(0);
      await expect(carta).not.toHaveClass(/dash-notare/);

      if (fine === 'finito') s.finisci(); else s.rompi();
      // Un fallimento aspetta la finestra di grazia della ripresa automatica (20 secondi, services/downloads.js).
      await expect.poll(() => statoScaricamento(shell, nome), { timeout: 45_000 }).toBe(fine === 'finito' ? 'completed' : 'interrupted');
      await expect(carta).toHaveClass(/dash-notare/, { timeout: 5_000 });
      await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(0);
      await expect(nellAngolo(shell)).toHaveCount(0);
    } finally {
      await s.chiudi();
    }
  });
}

test('timer scaduto con Filo non davanti mentre la finestra sta caricando: la notifica del sistema arriva lo stesso', async ({ app, shell }) => {
  await app.evaluate(() => globalThis.__filoAvvisoSistema.impostaPerProva(false));
  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate(([t]) => window.filoShell.message({ type: t, label: 'Finestra nuova', seconds: 1 }), [tipo]);
  await shell.waitForTimeout(1300);
  const caricava = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.webContents.reload();
    const l = w.webContents.isLoading();
    await globalThis.__filoAlarmWatcher._tick();
    return l;
  });
  expect(caricava).toBe(true);
  await expect.poll(() => registro(app), { timeout: 10_000 }).toEqual([{ titolo: 'Filo', testo: 'Timer «Finestra nuova» scaduto', chiusa: false }]);
});

test('un avviso a tempo arrivato con Filo ridotto a icona: è il clic sulla notifica a riportarlo in Filo', async ({ app, shell, avvisi, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>Un sito</h1>');
  await app.evaluate(() => globalThis.__filoAvvisoSistema.impostaPerProva(false));
  await shell.waitForTimeout(200);
  await shell.evaluate(() => window.filoNotify('Copia del progetto pronta', { durationSec: 30 }));
  await expect.poll(() => registro(app)).toEqual([{ titolo: 'Filo', testo: 'Copia del progetto pronta', chiusa: false }]);
  await expect(nellAngolo(shell)).toHaveCount(0);
  // Filo resta non davanti per la prova: lo riporta solo il clic, non il ritorno del fuoco.
  await app.evaluate(() => globalThis.__filoAvvisoSistema.registroProva[0].clic());
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'Copia del progetto pronta' })).toBeVisible({ timeout: 5_000 });
});

// Il menu della vista sopra la pagina è una finestra a sé: la si cerca fra quelle aperte.
async function menuDellAngolo(app) {
  let menu = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try { if (await w.evaluate(() => [...document.querySelectorAll('button.item')].some((b) => /Chiudi/.test(b.textContent)))) { menu = w; return true; } } catch (_) {}
    }
    return false;
  }, { timeout: 8_000 }).toBe(true);
  return menu;
}
const schedeAperte = (shell) => shell.evaluate(() => window.filoShell.tabs.snapshot()).then((s) => s.tabs.map((t) => String(t.url || '')));

test('nell\'angolo il tasto destro di un avviso nato da un sito apre quel sito', async ({ app, shell, avvisi, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>Un sito</h1>');
  const origine = testServer.html('<h1>Da dove nasce l\'avviso</h1>');
  await shell.evaluate((u) => window.filoNotify('Il sito ha chiesto di riprovare', { durationSec: 0, indirizzo: u, actions: [{ label: 'Riprova', onClick() {} }] }), origine);
  const vista = await avvisi();
  await vista.locator('.shell-notif.show .shell-notif-msg').click({ button: 'right' });
  const menu = await menuDellAngolo(app);
  expect(await menu.evaluate(() => [...document.querySelectorAll('button.item')].map((b) => b.textContent.trim()))).toEqual(['Riprova', 'Apri 127.0.0.1', 'Chiudi']);
  await menu.evaluate(() => [...document.querySelectorAll('button.item')].find((b) => /Apri 127/.test(b.textContent)).click());
  await expect.poll(() => schedeAperte(shell)).toContain(origine);
});

test('la carta volata nella home ha il tasto destro dell\'angolo: il sito da cui è nata si apre anche da lì', async ({ app, shell, testServer }) => {
  const home = await homePage(app);
  const origine = testServer.html('<h1>Da dove nasce l\'avviso</h1>');
  await shell.evaluate((u) => window.filoNotify('Il sito ha chiesto di riprovare', {
    durationSec: 1, indirizzo: u, actions: [{ label: 'Riprova', onClick() {} }],
  }), origine);
  const carta = home.locator('#accade > .dash-carta[data-tipo="cornice"]');
  await expect(carta).toHaveCount(1, { timeout: 8_000 });
  await carta.click({ button: 'right' });
  const menu = home.locator('.dash-menu');
  expect(await menu.locator('.dash-menu-voce').allTextContents()).toEqual(['Riprova', 'Apri 127.0.0.1', 'Chiudi', 'Apri nel filo']);
  await menu.locator('.dash-menu-voce', { hasText: 'Apri 127.0.0.1' }).click();
  await expect.poll(() => schedeAperte(shell)).toContain(origine);
  // Aprire il sito non chiude l'avviso, come nell'angolo.
  await expect(carta).toHaveCount(1);
});

test('chiesto a Filo a parole, l\'avviso volato nella colonna si chiude come col clic', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const home = await homePage(app);
  await shell.evaluate(() => window.filoNotify('La pagina dei voli non si apre', { durationSec: 1 }));
  const carta = home.locator('#accade > .dash-carta[data-tipo="cornice"]');
  await expect(carta).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => { await chrome.storage.local.set({ filo_onboarding: { done: true } }); });
  await modelloFinto(app, [
    { toolCalls: [{ id: 'c1', name: 'CARTA_HOME', arguments: '{"operazione":"togli","carta":"l\'avviso della pagina dei voli"}' }] },
    { text: 'Chiuso.' },
  ]);
  await chiedi(home, 'chiudi quell’avviso nella colonna');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Chiuso.' })).toBeVisible({ timeout: 10_000 });
  await expect(carta).toHaveCount(0, { timeout: 5_000 });
  await expect.poll(() => shell.evaluate(() => [...document.querySelectorAll('.shell-notif:not([data-closing="1"]) .shell-notif-msg')].map((n) => n.textContent)))
    .not.toContain('La pagina dei voli non si apre');
  // Il modello ha avuto la carta, non un «carta sconosciuta».
  const chiamate = await chiamateAlModello(app);
  expect(JSON.stringify(chiamate[chiamate.length - 1])).not.toContain('carta sconosciuta');
});

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}: l'avviso nell'angolo con icona e la carta volata nella home`, async ({ app, shell, avvisi, openTab, testServer }) => {
    const home = await homePage(app);
    await shell.emulateMedia({ colorScheme: tema });
    await home.emulateMedia({ colorScheme: tema });
    await shell.evaluate(() => window.filoNotify('Non sono riuscito ad aprire il file: forse è stato spostato', {
      durationSec: 1, errore: true, actions: [{ label: 'Apri cartella', onClick() {} }],
    }));
    await home.locator('.dash-carta-in-volo').waitFor({ timeout: 6_000 });
    await home.waitForTimeout(150);
    await home.screenshot({ path: `tests/.shots/2390-home-volo-${tema}.png` });
    await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(1, { timeout: 6_000 });
    await expect(home.locator('.dash-carta-in-volo')).toHaveCount(0, { timeout: 3_000 });
    await home.screenshot({ path: `tests/.shots/2390-home-carta-${tema}.png` });

    await testServer.openReady(openTab, '<h1>Un sito</h1><p>Una pagina qualunque.</p>');
    await shell.evaluate(() => window.filoNotify('Scaricato: relazione.pdf', { durationSec: 0, carta: 'download:abc', actions: [{ label: 'Apri file', onClick() {} }] }));
    const vista = await avvisi();
    await vista.emulateMedia({ colorScheme: tema });
    await expect(vista.locator('.shell-notif.show .shell-notif-ico svg')).toHaveCount(1);
    await vista.waitForTimeout(1200);
    await vista.screenshot({ path: `tests/.shots/2390-angolo-${tema}.png` });
  });
}
