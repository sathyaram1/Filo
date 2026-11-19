// #2377 — il doppio Ctrl: due tocchi aprono, dopo la soglia, il box con le lettere; Ctrl, Ctrl e una lettera fanno
// l'azione senza box. Non contano Ctrl+C/Ctrl+V, Ctrl+clic, tre tocchi; un tocco col box aperto lo chiude; un sito con
// Filo spento tiene Ctrl per sé; la soglia cambiata nelle Preferenze vale subito. Logica dei tocchi: tests/unit/doppioCtrl.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';
mkdirSync(SHOTS, { recursive: true });

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Gioco</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif"><h1>Una pagina</h1><p>Testo della pagina da leggere.</p><script>
    window.__tasti = [];
    window.addEventListener('keydown', (e) => { if (e.key && e.key.length === 1) window.__tasti.push(e.key); }, true);
  </script></body></html>`;

// I tasti come li manda la tastiera, alla vista che ha il fuoco: la scheda davanti o il box. Ogni passo è
// [ 'giu' | 'su', tasto, modificatori ] o [ 'attendi', ms ]; «tocco» è Ctrl premuto e lasciato.
function premi(app, passi, { nelBox = false } = {}) {
  return app.evaluate(async ({ BrowserWindow }, { passi, nelBox }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const box = BrowserWindow.getAllWindows().find((x) => x.webContents.getTitle() === 'Lettere di Filo');
    const wc = nelBox ? box.webContents : w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents;
    for (const p of passi) {
      if (p === 'tocco') {
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] });
        await new Promise((r) => setTimeout(r, 40));
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Control' });
        continue;
      }
      const [tipo, k, mod] = p;
      if (tipo === 'attendi') { await new Promise((r) => setTimeout(r, k)); continue; }
      if (tipo === 'clic') {
        wc.sendInputEvent({ type: 'mouseDown', x: 60, y: 60, button: 'left', clickCount: 1, modifiers: mod || [] });
        wc.sendInputEvent({ type: 'mouseUp', x: 60, y: 60, button: 'left', clickCount: 1, modifiers: mod || [] });
        continue;
      }
      wc.sendInputEvent({ type: tipo === 'giu' ? 'keyDown' : 'keyUp', keyCode: k, modifiers: mod || [] });
      if (tipo === 'giu' && k.length === 1) wc.sendInputEvent({ type: 'char', keyCode: k, modifiers: mod || [] });
    }
  }, { passi, nelBox });
}
const lettera = (l) => [['giu', l], ['su', l]];

const boxVisibile = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .some((x) => x.webContents.getTitle() === 'Lettere di Filo' && x.isVisible()));
async function boxPagina(app) {
  for (const w of app.windows()) { try { if (await w.title() === 'Lettere di Filo') return w; } catch (_) {} }
  return null;
}
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const imposta = (app, partial) => app.evaluate(async (_e, p) => { await globalThis.__filoHandlers.applySettingsUpdate(p); }, partial);
const temaScuro = (app) => app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);

async function sito(openTab, testServer) {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => { window.__tasti = []; });
  return page;
}

test('Ctrl, Ctrl: il box compare dopo l\'attesa con le lettere di serie; un tocco e poi Esc lo chiudono', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await sito(openTab, testServer);
  await premi(app, ['tocco', ['attendi', 80], 'tocco']);
  // Non subito: chi conosce la lettera non lo vede.
  expect(await boxVisibile(app)).toBe(false);
  await expect.poll(() => boxVisibile(app), { timeout: 5000 }).toBe(true);
  const box = await boxPagina(app);
  const righe = await box.evaluate(() => [...document.querySelectorAll('.riga')].map((r) => `${r.dataset.lettera}|${r.querySelector('.lbl').textContent}`));
  for (const r of ['c|Cerca nel filo', 'i|Impostazioni', 's|Cattura schermo', 'd|Tema chiaro o scuro', 'f|Schermo intero', 'h|Aiuto',
    'm|Muto', 'p|Pausa o riprendi', 'l|Leggi ad alta voce', 'a|Salva per dopo', 'z|Riapri scheda chiusa', 'b|Blocca il computer',
    'u|Cuffie preferite', 'o|Trascrivi']) expect(righe).toContain(r);
  expect(righe.some((r) => r.startsWith('r|'))).toBe(false);
  // Le app ci sono, senza lettera, in fondo.
  expect(righe).toContain('|Editor');
  await box.screenshot({ path: `${SHOTS}/2377-box-chiaro.png` });

  // Un tocco di Ctrl col box aperto lo chiude.
  await premi(app, ['tocco'], { nelBox: true });
  await expect.poll(() => boxVisibile(app)).toBe(false);
  // Esc lo chiude anche lui.
  await premi(app, ['tocco', ['attendi', 80], 'tocco']);
  await expect.poll(() => boxVisibile(app), { timeout: 5000 }).toBe(true);
  await box.keyboard.press('Escape');
  await expect.poll(() => boxVisibile(app)).toBe(false);
  // Col tema scuro il box è scuro.
  await imposta(app, { theme: 'dark' });
  await premi(app, ['tocco', ['attendi', 80], 'tocco']);
  await expect.poll(() => boxVisibile(app), { timeout: 5000 }).toBe(true);
  await expect.poll(() => box.evaluate(() => document.documentElement.classList.contains('scuro'))).toBe(true);
  await box.screenshot({ path: `${SHOTS}/2377-box-scuro.png` });
  await box.keyboard.press('Escape');
});

test('Ctrl, Ctrl, D cambia il tema senza mostrare il box, e la D non arriva alla pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await sito(openTab, testServer);
  const prima = await temaScuro(app);
  await premi(app, ['tocco', ['attendi', 80], 'tocco', ['attendi', 60], ...lettera('d')]);
  await expect.poll(() => temaScuro(app), { timeout: 5000 }).toBe(!prima);
  expect((await impostazioni(app)).theme).toBe(prima ? 'light' : 'dark');
  await page.waitForTimeout(900);
  expect(await boxVisibile(app)).toBe(false);
  expect(await page.evaluate(() => window.__tasti)).toEqual([]);
  // Di nuovo: torna com'era.
  await premi(app, ['tocco', ['attendi', 80], 'tocco', ['attendi', 60], ...lettera('d')]);
  await expect.poll(() => temaScuro(app), { timeout: 5000 }).toBe(prima);
});

test('Ctrl+C poi Ctrl+V, Ctrl+clic e tre tocchi non aprono niente', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await sito(openTab, testServer);
  await premi(app, [['giu', 'Control', ['control']], ['giu', 'C', ['control']], ['su', 'C', ['control']], ['su', 'Control'],
    ['attendi', 60], ['giu', 'Control', ['control']], ['giu', 'V', ['control']], ['su', 'V', ['control']], ['su', 'Control']]);
  await page.waitForTimeout(1000);
  expect(await boxVisibile(app)).toBe(false);
  await premi(app, [['giu', 'Control', ['control']], ['clic', 0, ['control']], ['su', 'Control'], ['attendi', 60], 'tocco']);
  await page.waitForTimeout(1000);
  expect(await boxVisibile(app)).toBe(false);
  await premi(app, ['tocco', ['attendi', 80], 'tocco', ['attendi', 80], 'tocco']);
  await page.waitForTimeout(1200);
  expect(await boxVisibile(app)).toBe(false);
  // Ctrl+C e Ctrl+V sono arrivati alla pagina; dopo tre tocchi anche una lettera è sua.
  expect(await page.evaluate(() => window.__tasti)).toEqual(['c', 'v']);
  await page.evaluate(() => { window.__tasti = []; });
  await premi(app, [['attendi', 500], ...lettera('d')]);
  await expect.poll(() => page.evaluate(() => window.__tasti)).toEqual(['d']);
});

test('su un sito con Filo spento il gesto non fa niente: Ctrl e la lettera restano del sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await sito(openTab, testServer);
  await imposta(app, { blocklist: [new URL(page.url()).hostname] });
  const prima = await temaScuro(app);
  await premi(app, ['tocco', ['attendi', 80], 'tocco', ['attendi', 60], ...lettera('d')]);
  await page.waitForTimeout(1000);
  expect(await temaScuro(app)).toBe(prima);
  expect(await boxVisibile(app)).toBe(false);
  expect(await page.evaluate(() => window.__tasti)).toEqual(['d']);
});

test('la soglia cambiata nelle Preferenze vale subito, e spento dalle Preferenze il gesto tace', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#doppioCtrlAcceso')).toBeChecked();
  await expect(pref.locator('#doppioCtrlSoglia')).toHaveValue('400');
  await expect(pref.locator('#sec-doppio-ctrl .tasto-ctrl').first()).toHaveText(process.platform === 'darwin' ? 'Cmd' : 'Ctrl');
  await pref.locator('#sec-doppio-ctrl').screenshot({ path: `${SHOTS}/2377-preferenze.png` });
  await pref.locator('#doppioCtrlSoglia').fill('1200');
  await pref.locator('#doppioCtrlSoglia').dispatchEvent('change');
  await expect.poll(async () => (await impostazioni(app)).doppioCtrl.sogliaMs).toBe(1200);

  await sito(openTab, testServer);
  // Due tocchi a 700 ms: con la soglia di serie (400) non sarebbero un doppio tocco.
  await premi(app, ['tocco', ['attendi', 700], 'tocco']);
  await expect.poll(() => boxVisibile(app), { timeout: 6000 }).toBe(true);
  await premi(app, ['tocco'], { nelBox: true });
  await expect.poll(() => boxVisibile(app)).toBe(false);

  const pref2 = await openTab('filo://preferences/preferences.html');
  await pref2.locator('#doppioCtrlAcceso').uncheck();
  await expect.poll(async () => (await impostazioni(app)).doppioCtrl.acceso).toBe(false);
  const page = await sito(openTab, testServer);
  await premi(app, ['tocco', ['attendi', 80], 'tocco', ['attendi', 60], ...lettera('d')]);
  await page.waitForTimeout(1500);
  expect(await boxVisibile(app)).toBe(false);
  expect(await page.evaluate(() => window.__tasti)).toEqual(['d']);
});

test('dal box: la lettera la sceglie, e una lettera nuova data all\'Editor lo apre', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await sito(openTab, testServer);
  await premi(app, ['tocco', ['attendi', 80], 'tocco']);
  await expect.poll(() => boxVisibile(app), { timeout: 5000 }).toBe(true);
  const box = await boxPagina(app);
  // Clic sul tasto dell'Editor, poi la lettera: la «e» è sua, e il box resta aperto con la riga nuova.
  await box.locator('.riga[data-id="app:editor"] .tasto').click();
  await expect(box.locator('.riga[data-id="app:editor"]')).toHaveClass(/cambio/);
  await box.screenshot({ path: `${SHOTS}/2377-box-cambio.png` });
  await box.keyboard.press('e');
  await expect.poll(async () => (await impostazioni(app)).doppioCtrl.lettere).toEqual([{ azione: 'app:editor', lettera: 'e' }]);
  await expect(box.locator('.riga[data-id="app:editor"]')).toHaveAttribute('data-lettera', 'e');
  expect(await boxVisibile(app)).toBe(true);
  // La lettera nel box fa l'azione e lo chiude.
  await box.keyboard.press('e');
  await expect.poll(() => boxVisibile(app)).toBe(false);
  const davanti = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).url;
  });
  await expect.poll(davanti, { timeout: 10_000 }).toMatch(/^filo:\/\/editor\//);
  // E senza box: da un sito, Ctrl, Ctrl, E porta all'Editor.
  await sito(openTab, testServer);
  await expect.poll(davanti).toMatch(/^http/);
  await premi(app, ['tocco', ['attendi', 80], 'tocco', ['attendi', 60], ...lettera('e')]);
  await expect.poll(davanti, { timeout: 10_000 }).toMatch(/^filo:\/\/editor\//);
  expect(await boxVisibile(app)).toBe(false);
});

test('C da un sito porta alla home con la ricerca aperta; Z riapre la scheda chiusa', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await sito(openTab, testServer);
  await premi(app, ['tocco', ['attendi', 80], 'tocco', ['attendi', 60], ...lettera('c')]);
  // La home di partenza c'è già, in un'altra scheda: quella giusta è la scheda del sito, diventata home.
  let casa = null;
  await expect.poll(async () => {
    for (const w of app.windows()) { try { if (/^filo:\/\/newtab\//.test(w.url()) && await w.locator('#cercaInput').isVisible()) { casa = w; return true; } } catch (_) {} }
    return false;
  }, { timeout: 15_000 }).toBe(true);
  await expect.poll(() => casa.evaluate(() => document.activeElement && document.activeElement.id)).toBe('cercaInput');
  expect(casa.url()).not.toContain('cerca');
  await casa.screenshot({ path: `${SHOTS}/2377-cerca-dalla-home.png` });

  // I apre il menu Impostazioni, lo stesso del suo tasto nella home.
  await premi(app, ['tocco', ['attendi', 80], 'tocco', ['attendi', 60], ...lettera('i')]);
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try { if (w.url().startsWith('data:text/html') && (await w.locator('button.item').allTextContents()).includes('Preferenze')) return true; } catch (_) {}
    }
    return false;
  }, { timeout: 10_000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).focus(); });

  // Una scheda chiusa torna con Ctrl, Ctrl, Z.
  const chiudi = await testServer.openReady(openTab, '<!doctype html><title>Da chiudere</title><p>x</p>');
  const indirizzo = chiudi.url();
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    tm.closeTab(tm.activeId);
  });
  await premi(app, ['tocco', ['attendi', 80], 'tocco', ['attendi', 60], ...lettera('z')]);
  await expect.poll(() => app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)
    ._filoTabs.tabs.some((t) => t.url === u), indirizzo), { timeout: 10_000 }).toBe(true);
});

test('M, U e B passano dalle porte della chat: muto e smuto, le cuffie preferite, il blocco; L legge la pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  // Un computer finto: i comandi arrivano a lui, con la stessa forma del vero.
  await app.evaluate(() => {
    globalThis.__chiamate = [];
    const pc = { muto: false, cuffie: false };
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer({
      async volume(p) { globalThis.__chiamate.push(['volume', p.muto]); pc.muto = p.muto; return { ok: true, volume: 40, muto: pc.muto, prima: 40 }; },
      async radio(p) { return { ok: true, acceso: p.acceso }; },
      async btElenco() { return { ok: true, acceso: true, dispositivi: [{ nome: 'Cuffie blu', indirizzo: 'AA:BB:CC:DD:EE:FF', collegato: pc.cuffie }] }; },
      async btCollega(p) { globalThis.__chiamate.push(['cuffie', p.collega]); pc.cuffie = p.collega; return { ok: true, collegato: p.collega }; },
    });
    const rq = process.mainModule.require;
    rq(rq('node:path').join(process.cwd(), 'src/main/services/bloccaComputer.js'))._perProve.usaFinto(() => { globalThis.__chiamate.push(['blocca']); return { ok: true }; });
  });
  await imposta(app, { bluetoothPreferiti: ['AA:BB:CC:DD:EE:FF'] });
  const page = await testServer.openReady(openTab, `${PAGINA}<script>
    window.__letto = '';
    document.addEventListener('filo:read-aloud', (e) => { window.__letto = e.detail && e.detail.text; });
  </script>`);
  const chiamate = () => app.evaluate(() => globalThis.__chiamate);
  const doppio = (l) => premi(app, ['tocco', ['attendi', 80], 'tocco', ['attendi', 60], ...lettera(l), ['attendi', 400]]);

  await doppio('m');
  await expect.poll(chiamate).toEqual([['volume', true]]);
  await doppio('u');
  await expect.poll(chiamate).toEqual([['volume', true], ['cuffie', true]]);
  await doppio('u');
  await expect.poll(chiamate).toEqual([['volume', true], ['cuffie', true], ['cuffie', false]]);
  await doppio('b');
  await expect.poll(chiamate).toEqual([['volume', true], ['cuffie', true], ['cuffie', false], ['blocca']]);

  await doppio('l');
  await expect.poll(() => page.evaluate(() => window.__letto), { timeout: 10_000 }).toContain('Testo della pagina da leggere.');
  expect(await page.evaluate(() => window.__tasti)).toEqual([]);

  // S e O sono le icone Cattura schermo e Trascrivi: la stessa strada della barra laterale, che le consegna alla pagina.
  await app.evaluate(({ BrowserWindow }) => {
    const b = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.barra;
    const vera = b.eseguiSullaPagina.bind(b);
    globalThis.__icone = [];
    b.eseguiSullaPagina = (id, o) => { const r = vera(id, o); globalThis.__icone.push([id, r]); return r; };
  });
  await doppio('s');
  await doppio('o');
  await expect.poll(() => app.evaluate(() => globalThis.__icone)).toEqual([['screenshot', true], ['transcribe', true]]);
  await app.evaluate(() => {
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer(null);
    const rq = process.mainModule.require;
    rq(rq('node:path').join(process.cwd(), 'src/main/services/bloccaComputer.js'))._perProve.usaFinto(null);
  });
});
