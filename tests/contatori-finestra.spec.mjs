// I contatori della finestra (#1470) nell'app vera: le schede chiuse per via e per età, gli spostamenti, le voci del
// menu della scheda, la carta d'anteprima, gli esiti delle notifiche, le azioni sugli scaricamenti, il riordino e quello
// che se ne disfa, la sessione ripristinata, l'ambiente. L'incognito non conta. Forma e invio: tests/unit/contatoriFinestra.test.mjs.

import { test, expect } from './fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// La finestra delle ore di oggi sommata: i conti si sommano, le schede tengono il massimo, l'ambiente l'ultimo.
const finestra = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const out = { schede: 0, finestre: 0, ambiente: '' };
  for (const [k, o] of Object.entries(s.ore || {}).sort()) {
    if (!k.startsWith(`${g}T`) || !o.finestra) continue;
    const f = o.finestra;
    out.schede = Math.max(out.schede, f.schede || 0);
    out.finestre = Math.max(out.finestre, f.finestre || 0);
    if (f.ambiente) out.ambiente = f.ambiente;
    for (const [c, m] of Object.entries(f)) {
      if (!m || typeof m !== 'object') continue;
      const t = out[c] || (out[c] = {});
      for (const [x, n] of Object.entries(m)) t[x] = (t[x] || 0) + n;
    }
  }
  return out;
});
// Il documento che partirebbe per l'ora in corso, e se passa la validazione dell'app.
const documento = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const C = globalThis.SN_CONTATORI;
  const F = globalThis.SN_CONTATORI_FINESTRA;
  const chiave = C.oraDi(Date.now());
  const doc = F.documento({ pseudonimo: 'a'.repeat(20), chiave, app: '0.2.249', os: 'win', dati: s.ore[chiave] });
  return { doc, valida: F.valida(doc) };
});
const ids = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.id));
const manager = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return w ? w._filoTabs.tabs.length : 0;
});

async function tastoDestroSullaScheda(shell, indice) {
  await shell.evaluate((i) => {
    const el = document.querySelectorAll('.tab')[i];
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
  }, indice);
}
async function cliccaVoce(app, voce) {
  for (const w of app.windows()) {
    try {
      const fatto = await w.evaluate((l) => {
        const b = [...document.querySelectorAll('button.item')].find((x) => x.textContent.trim() === l);
        if (!b) return false;
        b.click();
        return true;
      }, voce);
      if (fatto) return true;
    } catch (_) {}
  }
  return false;
}
async function scegliSullaScheda(app, shell, indice, voce, finito) {
  await expect.poll(async () => {
    if (await finito()) return true;
    await tastoDestroSullaScheda(shell, indice);
    for (let i = 0; i < 15; i++) { if (await cliccaVoce(app, voce)) break; await sleep(40); }
    await sleep(300);
    return finito();
  }, { timeout: 25_000, intervals: [200, 400, 800, 1200] }).toBe(true);
}
async function trascina(shell, da, a) {
  await shell.evaluate(([i, j]) => {
    const tabs = [...document.querySelectorAll('.tab')];
    const fr = tabs[i].getBoundingClientRect();
    const tr = tabs[j].getBoundingClientRect();
    const y = Math.round(fr.top + fr.height / 2);
    const fire = (t, type, x) => t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: Math.round(x), clientY: y }));
    const x0 = fr.left + fr.width / 2;
    fire(tabs[i], 'mousedown', x0);
    fire(window, 'mousemove', x0 + 10);
    fire(window, 'mousemove', tr.right - 2);
    fire(window, 'mousemove', tr.right + 30);
    fire(window, 'mouseup', tr.right + 30);
  }, [da, a]);
}

test('la barra delle schede: chiusure per via, spostamenti, voci del menu, massimo di schede e ambiente', async ({ app, shell, openTab }) => {
  await openTab('filo://options/options.html');
  await openTab('filo://history/history.html');
  await openTab('filo://quaderno/quaderno.html');
  await openTab('filo://downloads/');
  await expect.poll(() => shell.locator('.tab').count()).toBeGreaterThanOrEqual(5);

  // Un «Duplica» dal tasto destro sulla scheda.
  const prima = await manager(app);
  await scegliSullaScheda(app, shell, 1, 'Duplica', async () => (await manager(app)) > prima);
  const massimo = await manager(app);

  // La X, il tasto centrale, «Chiudi» dal menu della scheda.
  const n0 = (await ids(shell)).length;
  await shell.evaluate(() => document.querySelectorAll('.tab')[1].querySelector('.close').click());
  await expect.poll(async () => (await ids(shell)).length).toBe(n0 - 1);
  await shell.evaluate(() => {
    const el = document.querySelectorAll('.tab')[1];
    el.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
  });
  await expect.poll(async () => (await ids(shell)).length).toBe(n0 - 2);
  await scegliSullaScheda(app, shell, 1, 'Chiudi', async () => (await ids(shell)).length === n0 - 3);

  // Trascinata dalla prima all'ultima.
  const ordine = await ids(shell);
  await trascina(shell, 0, ordine.length - 1);
  await expect.poll(async () => (await ids(shell)).at(-1)).toBe(ordine[0]);

  await expect.poll(async () => {
    const f = await finestra(app);
    return {
      x: f.chiusuraScheda?.['pulsante_x:m1'] || 0,
      centrale: f.chiusuraScheda?.['clic_centrale:m1'] || 0,
      menu: f.chiusuraScheda?.['tasto_destro_scheda:m1'] || 0,
      duplica: f.voceMenuScheda?.['tab-duplicate'] || 0,
      spostata: Object.values(f.schedaTrascinata || {}).reduce((a, n) => a + n, 0),
    };
  }, { timeout: 10_000 }).toEqual({ x: 1, centrale: 1, menu: 1, duplica: 1, spostata: 1 });
  const f = await finestra(app);
  expect(f.schede, 'il massimo dell’ora, non le schede di adesso').toBeGreaterThanOrEqual(massimo);
  expect(f.finestre).toBe(1);
  expect(f.ambiente).toMatch(/^(w1024|w1366|w1600|w1920|oltre):(1|1_25|1_5|2|altro):(normale|massimizzata|schermo_intero):(chiaro|scuro)$/);
  const { doc, valida } = await documento(app);
  expect(valida.ok, valida.motivo).toBe(true);
  expect(doc.schedeAperte).toMatch(/^n(2_5|6_10):n1$/);
  expect(JSON.stringify(doc)).not.toMatch(/options|history|quaderno|filo:/);

  // Il tema scuro si vede nell'ambiente dell'ora.
  await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ theme: 'dark' }));
  await expect.poll(async () => (await finestra(app)).ambiente, { timeout: 10_000 }).toMatch(/:scuro$/);
});

test('le notifiche: tipo ed esito, mai il testo; letta, in attesa, sostituita, scaduta', async ({ app, shell, avvisi }) => {
  await shell.evaluate(() => window.filoNotify('Da chiudere con la X', { durationSec: 0, tipo: 'sito_bloccato' }));
  const vista = await avvisi();
  const carta = vista.locator('.shell-notif.show', { hasText: 'Da chiudere con la X' });
  await carta.hover();
  await carta.locator('.shell-notif-close').click();

  // Dal main, come manda ogni avviso: l'azione si arma dopo un attimo e conta il suo indice.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.webContents.send('shell:toast', { text: 'Scaricato: relazione finale.pdf', opts: { durationSec: 0, tipo: 'download_finito', actions: [{ label: 'Apri cartella', revealDownloadId: 'non-c-e' }] } });
  });
  const azione = vista.locator('.shell-notif-action', { hasText: 'Apri cartella' });
  await azione.waitFor();
  await expect(azione).toBeEnabled({ timeout: 4000 });
  await azione.click();

  // Una gemella con la stessa chiave prende il posto della prima; una breve scade da sé, col puntatore altrove
  // (sopra la pila i tempi aspettano).
  await vista.evaluate(() => window.avvisi.sopra(false));
  await shell.evaluate(() => {
    window.filoNotify('Prima', { durationSec: 0, unica: 'gemelle', tipo: 'aiuto_spento' });
    window.filoNotify('Seconda', { durationSec: 0, unica: 'gemelle', tipo: 'aiuto_spento' });
    window.filoNotify('Breve', { durationSec: 1, tipo: 'riordino_schede' });
    window.filoNotify('Senza tipo', { durationSec: 0 });
  });
  await expect.poll(async () => (await finestra(app)).notifica?.['riordino_schede:scaduta'] || 0, { timeout: 20_000 }).toBe(1);
  // Sette insieme: oltre il tetto qualcuna aspetta dietro il «+N»; «Chiudi tutti» le porta via.
  await shell.evaluate(() => { for (let i = 0; i < 7; i++) window.filoNotify(`Raffica ${i}`, { durationSec: 0, tipo: 'popup_bloccato' }); });
  await vista.locator('[data-pila="apri"]').click();
  const tutte = vista.locator('[data-pila="chiudi-tutti"]');
  await tutte.waitFor({ timeout: 5000 });
  await expect(tutte).toBeEnabled({ timeout: 4000 });
  await tutte.click();
  await expect(shell.locator('.shell-notif:not([data-closing="1"])')).toHaveCount(0, { timeout: 5000 });

  await expect.poll(async () => {
    const n = (await finestra(app)).notifica || {};
    return {
      x: n['sito_bloccato:chiusa_x'] || 0, letta: n['sito_bloccato:letta'] || 0, azione: n['download_finito:azione_0'] || 0,
      sostituita: n['aiuto_spento:sostituita'] || 0, tutte: n['popup_bloccato:chiuse_tutte'] || 0,
      attesa: (n['popup_bloccato:in_attesa'] || 0) > 0, altro: (n['altro:chiuse_tutte'] || 0) + (n['aiuto_spento:chiuse_tutte'] || 0),
    };
  }, { timeout: 10_000 }).toEqual({ x: 1, letta: 1, azione: 1, sostituita: 1, tutte: 7, attesa: true, altro: 2 });
  // L'azione sulla notifica è anche un'azione sullo scaricamento, col suo luogo.
  expect((await finestra(app)).downloadAzione?.['notifica:apri_cartella']).toBe(1);
  const { doc } = await documento(app);
  expect(JSON.stringify(doc)).not.toMatch(/relazione|Raffica|Apri cartella/);
});

test('la carta d’anteprima: lo stato della foto, se si clicca la scheda o si va via, e quanto si resta', async ({ app, shell, openTab, testServer }) => {
  await openTab(testServer.html('<!doctype html><html><body style="background:#fd8"><h1>Uno</h1></body></html>'));
  await openTab(testServer.html('<!doctype html><html><body style="background:#8df"><h1>Due</h1></body></html>'));
  await expect.poll(() => shell.locator('.tab').count()).toBeGreaterThanOrEqual(3);
  const dietro = shell.locator('.tab:not(.active)').last();
  await dietro.hover();
  await sleep(900);
  await shell.mouse.move(5, 5);
  await shell.mouse.move(5, 400);
  await expect.poll(async () => Object.keys((await finestra(app)).anteprimaScheda || {}).filter((k) => k.includes(':via:')).length, { timeout: 8000 }).toBe(1);
  await dietro.hover();
  await sleep(900);
  await dietro.click();
  await expect.poll(async () => Object.keys((await finestra(app)).anteprimaScheda || {}).find((k) => k.includes(':clic_sulla_scheda:')) || '', { timeout: 8000 })
    .toMatch(/^(pronta|vecchia|assente):clic_sulla_scheda:(ms500|s1|s2|s5|oltre)$/);
});

test('il riordino: il giro, le schede che chiude, quella riaperta dall’archivio e lo spostamento subito dopo; la sessione ripristinata', async ({ app, shell, openTab, testServer }) => {
  const url = testServer.html('<!doctype html><html><body><p>doppia</p></body></html>');
  await openTab(url);
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    tm.openTab(u, { activate: false, allowDuplicate: true });
  }, url);
  await openTab('filo://history/history.html');
  // I colori a rovescio: il riordino per colore cambia l'ordine.
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    const colori = ['#2040ff', '#20c040', '#ff2020', '#ffd000'];
    tm.tabs.forEach((t, i) => tm.setTabIdentityColor(t.id, colori[i % colori.length]));
  });
  const home = app.windows().find((w) => { try { return w.url().startsWith('filo://history'); } catch (_) { return false; } });
  await home.waitForLoadState('domcontentloaded');
  // Il modello che giudica tiene tutto: chiude solo la regola dei duplicati.
  await app.evaluate(() => { globalThis.SN_TAB_TRIAGE_DECIDE = async () => ({ decisions: [] }); });
  const r = await home.evaluate(() => chrome.runtime.sendMessage({ type: 'run_tab_triage' }));
  expect(r.archived).toBe(1);
  await expect.poll(async () => {
    const f = await finestra(app);
    return {
      giro: f.riordinoAutomatico?.['manual:duplicato:n1'] || 0, modello: f.riordinoAutomatico?.['manual:modello:n0'] || 0,
      chiusa: f.chiusuraScheda?.['riordino_automatico:m1'] || 0,
    };
  }, { timeout: 10_000 }).toEqual({ giro: 1, modello: 1, chiusa: 1 });

  // Spostata a mano subito dopo il riordino.
  await trascina(shell, 0, 1);
  await expect.poll(async () => (await finestra(app)).riordinoAutomatico?.spostata_a_mano || 0, { timeout: 8000 }).toBe(1);

  // Riaperta dall'archivio la scheda che il riordino aveva chiuso.
  let voce = null;
  await expect.poll(async () => {
    voce = await app.evaluate(async (_e, u) => (await globalThis.SN_ARCHIVED_TABS.list()).find((t) => t.url === u && t.reason !== 'manual') || null, url);
    return !!voce;
  }, { timeout: 8000 }).toBe(true);
  await home.evaluate((id) => chrome.runtime.sendMessage({ type: 'reopen_archived_tab', id }), voce.id);
  await expect.poll(async () => (await finestra(app)).riordinoAutomatico?.['riaperta:m1'] || 0, { timeout: 8000 }).toBe(1);

  // Una sessione di tre schede torna; una si chiude subito con la X, poi Filo esce.
  const n0 = (await ids(shell)).length;
  await app.evaluate(async ({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    await globalThis.SN_STORAGE.setRaw(tm._sessionKey(), { tabs: [`${u}?a`, `${u}?b`, `${u}?c`], activeIndex: 0 });
    await tm.restoreSession();
  }, url);
  await expect.poll(async () => (await ids(shell)).length).toBe(n0 + 3);
  await shell.evaluate(() => document.querySelectorAll('.tab')[document.querySelectorAll('.tab').length - 1].querySelector('.close').click());
  await expect.poll(async () => (await ids(shell)).length).toBe(n0 + 2);
  await app.evaluate(() => globalThis.SN_CONTATORI_FINESTRA_MAIN.allUscita());
  await expect.poll(async () => (await finestra(app)).sessioneRipristinata || {}, { timeout: 8000 }).toEqual({ 'n2_5:q50': 1 });
  const { valida } = await documento(app);
  expect(valida.ok, valida.motivo).toBe(true);
});

test('gli scaricamenti: le azioni per luogo, dalla pagina Download e dal pannello', async ({ app, shell, openTab }) => {
  const pagina = await openTab('filo://downloads/');
  await pagina.evaluate(() => chrome.runtime.sendMessage({ type: 'downloads_clear' }));
  await pagina.evaluate(() => chrome.runtime.sendMessage({ type: 'download_pause', id: 'nessuno' }));
  await shell.evaluate(() => window.filoShell.downloads.openFolder('nessuno'));
  await shell.evaluate(() => window.filoShell.downloads.openFile('nessuno', false));
  // Il sì alla domanda su un programma è lo stesso gesto: non conta di nuovo.
  await shell.evaluate(() => window.filoShell.downloads.openFile('nessuno', true));
  await expect.poll(async () => (await finestra(app)).downloadAzione || {}, { timeout: 8000 })
    .toEqual({ 'pagina:svuota': 1, 'pagina:pausa': 1, 'pannello:apri_cartella': 1, 'pannello:apri_file': 1 });
});

test('in incognito e a contatori spenti non si conta niente della finestra', async ({ app, shell, openTab }) => {
  await openTab('filo://history/history.html');
  const home = app.windows().find((w) => { try { return w.url().startsWith('filo://history'); } catch (_) { return false; } });
  await home.evaluate(() => chrome.runtime.sendMessage({ type: 'open_incognito' }));
  await expect.poll(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito && w._filoTabs))).toBe(true);
  const prima = await finestra(app);
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)._filoTabs;
    tm.openTab('filo://newtab/');
    tm.closeTab(tm.tabs[0].id, { via: 'pulsante_x' });
    tm.moveTab(tm.tabs[0].id, 1);
  });
  // La cornice in incognito: la sua notifica chiusa con la X passa dal suo canale, che non conta.
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
    return w.webContents.executeJavaScript('typeof window.filoNotify === "function"');
  })).toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
    return w.webContents.executeJavaScript(`(() => { const c = window.filoNotify('In incognito', { durationSec: 0, tipo: 'sito_bloccato' }); c.querySelector('.shell-notif-close').click(); })()`);
  });
  // Un conto arriva con una scrittura asincrona: si lascia il tempo di arrivare, se dovesse.
  await sleep(1500);
  const dopo = await finestra(app);
  expect(dopo.chiusuraScheda || {}).toEqual(prima.chiusuraScheda || {});
  expect(dopo.schedaTrascinata || {}).toEqual(prima.schedaTrascinata || {});
  expect(dopo.notifica || {}).toEqual(prima.notifica || {});

  // Spenti: una chiusura con la X nella finestra normale non entra, e quello che c'era si butta.
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ contatori: { attivi: false } }); });
  await shell.evaluate(() => document.querySelectorAll('.tab')[0].querySelector('.close').click());
  await sleep(1500);
  const s = await app.evaluate(async () => globalThis.SN_CONTATORI_MAIN.letto());
  expect(Object.values(s.ore || {}).filter((o) => o.finestra)).toEqual([]);
});
