// Le strade dei contatori (#1468) nell'app vera: da quale strada parte un'azione (tasto, pulsante della scheda, barra
// dei menu, menu della scheda, comando della home, barra laterale), i tasti dei browser e Ctrl+Shift+T o Ctrl+L tornati
// indietro subito, il tasto destro e il menu nativo, la scorciatoia muta. Forma e regole: tests/unit/contatoriStrade.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { barraPage, comandaBarra, pannelloFermo, premiNellaBarra, menuAperto, scegliNelMenu } from './helpers/barra.mjs';

const SPENTO = 'spento-1468.test';
test.use({ hostInPiu: [SPENTO] });

// Le ore di oggi sommate, misura per misura.
const strade = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const out = {};
  for (const [k, ora] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`) || !ora.strade) continue;
    for (const [m, conti] of Object.entries(ora.strade)) {
      for (const [chiave, n] of Object.entries(conti || {})) (out[m] = out[m] || {})[chiave] = ((out[m] || {})[chiave] || 0) + n;
    }
  }
  return out;
});
const voce = async (app, misura, chiave) => ((await strade(app))[misura] || {})[chiave] || 0;

const attiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  const a = t.tabs.find((x) => x.id === t.activeId);
  return { id: t.activeId, url: a ? a.url : '', n: t.tabs.length };
});
// Il tasto come lo vede il main prima della pagina: sulla scheda davanti.
const premi = (app, keyCode, modifiers = []) => app.evaluate(({ BrowserWindow }, [kc, mod]) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: kc, modifiers: mod });
  t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: kc, modifiers: mod });
}, [keyCode, modifiers]);
// Una voce della barra dei menu, come un clic (su Windows e Linux i suoi tasti li prende la pagina).
const voceDellaBarra = (app, etichetta) => app.evaluate(({ Menu }, label) => {
  const cerca = (voci) => {
    for (const v of voci) {
      if (v.label === label && typeof v.click === 'function') return v;
      if (v.submenu) { const dentro = cerca(v.submenu.items); if (dentro) return dentro; }
    }
    return null;
  };
  const v = cerca(Menu.getApplicationMenu().items);
  if (v) v.click();
  return !!v;
}, etichetta);

test('i tasti di un altro browser per nome, la scheda nuova dalla scorciatoia; le lettere scritte in un campo no', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html('<title>SITO</title><input id="c" autofocus><h1 id="ok">x</h1>'));
  await page.waitForSelector('#ok');
  await page.locator('#c').click();
  await page.keyboard.type('ciao');
  await premi(app, 'J', ['control']);
  await premi(app, 'F5');
  const prima = await attiva(app);
  await premi(app, 'T', ['control']);
  await expect.poll(() => attiva(app).then((a) => a.n)).toBe(prima.n + 1);
  await expect.poll(() => voce(app, 'via_azione', 'newTab:scorciatoia')).toBe(1);
  const s = await strade(app);
  expect(s.tasto_da_browser).toEqual({ ctrl_j: 1, f5: 1, ctrl_t: 1 });
});

test('Ctrl+Shift+T che ridà una scheda chiusa subito senza navigarci, e Ctrl+L che porta alla home lasciata senza scrivere', async ({ app, openTab, testServer }) => {
  const url = testServer.html('<title>UNO</title><h1 id="ok">1</h1>');
  await openTab(testServer.html('<title>RESTA</title><h1>r</h1>'));
  const page = await openTab(url);
  await page.waitForSelector('#ok');
  await premi(app, 'W', ['control']);
  await expect.poll(() => voce(app, 'via_azione', 'closeTab:scorciatoia')).toBe(1);
  await premi(app, 'T', ['control', 'shift']);
  await expect.poll(() => attiva(app).then((a) => a.url)).toBe(url);
  await premi(app, 'W', ['control']);
  await expect.poll(() => voce(app, 'tasto_da_browser', 'aspettativa_mancata:ctrl_shift_t')).toBe(1);
  expect(await voce(app, 'tasto_da_browser', 'ctrl_shift_t')).toBe(1);

  // Ctrl+L da un sito porta la home nella stessa scheda; Ctrl+Tab la lascia senza averci scritto.
  const sito = await openTab(testServer.html('<title>DUE</title><h1 id="ok">2</h1>'));
  await sito.waitForSelector('#ok');
  await premi(app, 'L', ['control']);
  await expect.poll(() => attiva(app).then((a) => a.url)).toMatch(/^filo:\/\/newtab\//);
  await premi(app, 'Tab', ['control']);
  await expect.poll(() => voce(app, 'tasto_da_browser', 'aspettativa_mancata:ctrl_l')).toBe(1);
  expect(await voce(app, 'tasto_da_browser', 'ctrl_tab')).toBe(1);
});

test('il pulsante della scheda nuova, la barra dei menu e la pagina di Filo col suo tempo davanti, l\'Aiuto dal menu', async ({ app, shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>SITO</title><h1>x</h1>'));
  await shell.locator('#tab-new').click();
  await expect.poll(() => voce(app, 'via_azione', 'newTab:pulsante_scheda')).toBe(1);
  expect(await voceDellaBarra(app, 'Nuova scheda')).toBe(true);
  await expect.poll(() => voce(app, 'via_azione', 'newTab:menu_app')).toBe(1);

  expect(await voceDellaBarra(app, 'Preferenze')).toBe(true);
  await expect.poll(() => attiva(app).then((a) => a.url)).toMatch(/^filo:\/\/preferences\//);
  expect(await voce(app, 'pagina_di_filo_aperta', 'preferences:menu_app')).toBe(1);
  // Lasciata subito: il tempo davanti esce in fasce, una volta.
  expect(await voceDellaBarra(app, 'Nuova scheda')).toBe(true);
  await expect.poll(async () => Object.keys((await strade(app)).pagina_di_filo_aperta || {}).filter((k) => k.startsWith('vista:preferences:')).length).toBe(1);

  expect(await voceDellaBarra(app, 'Opzioni')).toBe(true);
  await expect.poll(() => voce(app, 'via_azione', 'openOptions:menu_app')).toBe(1);
  expect(await voce(app, 'pagina_di_filo_aperta', 'options:menu_app')).toBe(1);

  const sito = await openTab(testServer.html('<title>AIUTO</title><h1>a</h1>'));
  await sito.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  expect(await voceDellaBarra(app, 'Assistente laterale')).toBe(true);
  await expect.poll(() => voce(app, 'aiuto_aperto', 'menu_app')).toBe(1);
  expect(await voce(app, 'via_azione', 'help:menu_app')).toBe(1);
});

test('il comando della home apre la pagina di Filo dalla sua strada, ed è anche l\'azione dell\'icona', async ({ app, openTab }) => {
  const home = await openTab('filo://newtab/');
  const scrivi = async (t) => { const i = home.locator('#input'); await i.fill(t); await i.press('Enter'); };
  await scrivi('/editor');
  await expect.poll(() => voce(app, 'pagina_di_filo_aperta', 'editor:comando_slash')).toBe(1);
  expect(await voce(app, 'via_azione', 'editorApp:comando_slash')).toBe(1);
  await expect.poll(() => attiva(app).then((a) => a.url)).toMatch(/^filo:\/\/editor\//);
  const s = await strade(app);
  expect(Object.keys(s.pagina_di_filo_aperta).some((k) => k.includes('collegamento_interno')), 'il comando non è un collegamento').toBe(false);
});

// L'azione che il prompt della chat fa emettere per «apri le preferenze»: la chat apre la pagina da sola.
test('la chat che apre da sola una pagina di Filo conta la strada «chat», per la pagina e per l\'icona che la apre', async ({ app, openTab }) => {
  const home = await openTab('filo://newtab/');
  const naviga = (url) => home.evaluate((u) => chrome.runtime.sendMessage({
    type: window.SN_MSG.MSG.FILO_RUN_ACTION, action: { type: 'NAVIGA', url: u },
  }), url);
  expect((await naviga('filo://preferences/preferences.html')).ok).toBe(true);
  await expect.poll(() => attiva(app).then((a) => a.url)).toMatch(/^filo:\/\/preferences\//);
  await expect.poll(() => voce(app, 'pagina_di_filo_aperta', 'preferences:chat')).toBe(1);
  expect((await naviga('filo://options/options.html')).ok).toBe(true);
  await expect.poll(() => voce(app, 'pagina_di_filo_aperta', 'options:chat')).toBe(1);
  expect(await voce(app, 'via_azione', 'openOptions:chat')).toBe(1);
});

test('il tasto destro: su che cosa si apre, Shift che lo scavalca, il menu del sito e «sempre» acceso e spento', async ({ app, openTab, testServer }) => {
  const MENU_SUO = `<!doctype html><html><head><meta charset="utf-8"><meta property="og:site_name" content="Sito di prova">
<script>document.addEventListener('contextmenu', function (e) {
  if (e.target.closest && e.target.closest('#libero')) return;
  e.preventDefault(); document.getElementById('menu-suo').hidden = false; });
document.addEventListener('click', function () { document.getElementById('menu-suo').hidden = true; });</script></head>
<body style="margin:0;padding:40px;font:16px sans-serif"><div id="area" style="width:420px;height:160px;background:#cde">tela</div>
<p id="libero"><a id="link" href="https://example.invalid/x">un collegamento</a></p><div id="menu-suo" hidden>menu del sito</div></body></html>`;
  const page = await testServer.openReady(openTab, MENU_SUO, { pubblico: true });

  await page.keyboard.down('Shift');
  await page.locator('#area').click({ button: 'right', position: { x: 30, y: 30 } });
  await page.keyboard.up('Shift');
  await expect.poll(() => voce(app, 'menu_nativo_scelto', 'shift_tasto_destro')).toBe(1);
  await expect(menuDi(page).locator('.sn-menu')).toHaveCount(0);

  await page.locator('#link').click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu').first()).toBeVisible();
  await expect.poll(() => voce(app, 'contesto_box', 'collegamento')).toBe(1);
  await page.keyboard.press('Escape');

  await page.locator('#area').click({ button: 'right', position: { x: 60, y: 50 } });
  await expect.poll(() => voce(app, 'contesto_box', 'pagina')).toBe(1);
  await menuDi(page).locator('.sn-menu .sn-menu-split-main', { hasText: 'Menu di Sito di prova' }).click();
  await expect(page.locator('#menu-suo')).toBeVisible();
  await expect.poll(() => voce(app, 'menu_nativo_scelto', 'menu_del_sito:voce')).toBe(1);

  await page.mouse.click(600, 400);
  await page.locator('#area').click({ button: 'right' });
  await menuDi(page).locator('.sn-menu .sn-menu-split-arrow').first().hover();
  await menuDi(page).locator('.sn-menu-sub .sn-menu-item', { hasText: 'Aprilo subito col tasto destro' }).click();
  await expect.poll(() => voce(app, 'menu_nativo_scelto', 'menu_del_sito:sempre_acceso')).toBe(1);

  const pref = await openTab('filo://preferences/preferences.html');
  const riga = pref.locator('#menuDelSitoSiti .mem-riga', { hasText: 'sito-pubblico.test' });
  await riga.hover();
  await riga.locator('.mem-via').click();
  await expect.poll(() => voce(app, 'menu_nativo_scelto', 'menu_del_sito:sempre_spento')).toBe(1);
  const s = await strade(app);
  expect(JSON.stringify(s)).not.toContain('sito-pubblico');
});

test('una scorciatoia muta dove Filo è spento conta il perché, e solo se è partita dal tasto', async ({ app, openTab, testServer }) => {
  await app.evaluate(async (_e, sito) => { await globalThis.SN_STORAGE.updateSettings({ blocklist: [sito] }); }, SPENTO);
  const page = await openTab(testServer.html('<title>Spento</title><p id="t">Un paragrafo da spiegare.</p>').replace('127.0.0.1', SPENTO));
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#t').dblclick();
  const tasto = await app.evaluate(() => globalThis.SN_TASTI.scorciatoiaFilo('explain-selection'));
  const [mod, lettera] = tasto.split('+');
  await premi(app, lettera, [mod.toLowerCase()]);
  await expect.poll(() => voce(app, 'scorciatoia_a_vuoto', 'explain-selection:filo_spento_sul_sito')).toBe(1);
  expect(await voce(app, 'via_azione', 'explain-selection:scorciatoia')).toBe(1);
  // La stessa pagina che dice «muta» senza un tasto vero davanti non conta.
  const r = await app.evaluate((_e, url) => globalThis.SN_HANDLE_MESSAGE({
    type: globalThis.SN_MSG.MSG.CONTATORI_EVENTO, misura: 'a-vuoto', comando: 'translate-selection', motivo: 'filo_spento_sul_sito',
  }, { url, interna: false }), page.url());
  expect(r && r.ok).toBe(false);
  expect(await voce(app, 'scorciatoia_a_vuoto', 'translate-selection:filo_spento_sul_sito')).toBe(0);
});

test('la barra laterale: indietro dall\'icona, avanti dall\'elenco col posto della pagina, l\'Aiuto dall\'icona', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<title>Pagina A</title><h1>a</h1>');
  const b = testServer.html('<title>Pagina B</title><h1>b</h1>');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.evaluate((u) => { location.href = u; }, b);
  await page.waitForURL(b);
  await premiNellaBarra(app, 'back');
  await expect.poll(() => attiva(app).then((x) => x.url)).toBe(a);
  await expect.poll(() => voce(app, 'navigazione_cronologia', 'indietro:barra')).toBe(1);
  expect(await voce(app, 'via_azione', 'back:barra')).toBe(1);

  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="forward"]').click({ button: 'right' });
  const menu = await menuAperto(app);
  expect(menu).not.toBeNull();
  await scegliNelMenu(menu, 'Pagina B');
  await expect.poll(() => attiva(app).then((x) => x.url)).toBe(b);
  await expect.poll(() => voce(app, 'navigazione_cronologia', 'avanti:barra_lista:p1')).toBe(1);
  expect(await voce(app, 'via_azione', 'forward:barra'), 'l\'elenco non è il pulsante Avanti').toBe(0);

  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await premiNellaBarra(app, 'help');
  await expect.poll(() => voce(app, 'aiuto_aperto', 'barra')).toBe(1);
  expect(await voce(app, 'via_azione', 'help:barra')).toBe(1);

  // La chiusura dalla barra conta una volta, dalla scheda che si chiude.
  const prima = await attiva(app);
  await premiNellaBarra(app, 'closeTab');
  await expect.poll(() => attiva(app).then((x) => x.n)).toBe(prima.n - 1);
  await new Promise((r) => setTimeout(r, 300));
  expect(await voce(app, 'via_azione', 'closeTab:barra')).toBe(1);
});
