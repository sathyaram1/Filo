// Verifica #2372, giro 1: le strade che il lavoro non ha già provato (fuoco perso, carte nel «+», ricerca, lettere).
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { home } from '../../helpers/chatFinta.mjs';
import { homeIntera } from '../../helpers/tastiHome.mjs';

const SHOTS = 'tests/.shots/v2372';
mkdirSync(SHOTS, { recursive: true });

async function casa(app) {
  await homeIntera(app);
  const page = await home(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#altroPiu')).toBeVisible({ timeout: 10_000 });
  return page;
}
const inVista = (page) => page.locator('.dash-altro-griglia.vista .dash-altro-app[data-tasto="1"]').evaluateAll((ns) => ns.map((n) => n.dataset.id));
const fuocoId = (page) => page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
const aperte = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return w._filoTabs.tabs.filter((t) => { try { return t.view.webContents.getURL().startsWith(u); } catch (_) { return false; } }).length;
}, url);
const daiLettera = (app, l, url) => app.evaluate((_, x) => globalThis.SN_STORAGE.updateSettings({ doppioTocco: { lettere: [{ lettera: x.l, url: x.url }] } }), { l, url });

async function semina(app) {
  await app.evaluate(async () => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const ora = Date.now();
    const iso = (minFa) => new Date(ora - minFa * 60_000).toISOString();
    const ev = [];
    const chat = (id, testi, minFa) => {
      ev.push(E.crea(E.TIPI.CHAT_APERTA, { chat: id }, { ts: iso(minFa), dispositivo: qui }));
      testi.forEach(([role, text], i) => ev.push(E.crea(E.TIPI.MESSAGGIO, { chat: id, msg: { role, text } }, { ts: iso(minFa - i * 0.1), dispositivo: qui, autore: role === 'user' ? 'utente' : 'filo' })));
      ev.push(E.crea(E.TIPI.CHAT_CHIUSA, { chat: id }, { ts: iso(minFa - 0.5), dispositivo: qui }));
    };
    chat('orche', [['user', 'come cacciano le orche? <b>grassetto</b>'], ['filo', 'In branco, con le onde.']], 300);
    for (let i = 0; i < 30; i++) chat(`x${i}`, [['user', `riempitivo numero ${i}`], ['filo', `risposta ${i}`]], 200 - i * 4);
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  });
}

test('fuoco perso: Backspace e Ctrl+V finiscono nel campo della chat come le lettere', async ({ app }) => {
  const page = await casa(app);
  await page.keyboard.type('ciao');
  await expect(page.locator('#input')).toHaveValue('ciao');
  // Un clic su un punto vuoto del centro: il fuoco lascia il campo.
  await page.mouse.click(640, 300);
  await page.keyboard.press('Backspace');
  await expect.soft(page.locator('#input')).toHaveValue('cia');
  await page.locator('#input').fill('cia');
  await app.evaluate(({ clipboard }) => clipboard.writeText(' incollato'));
  await page.mouse.click(640, 300);
  await page.keyboard.press('Control+V');
  await expect.soft(page.locator('#input')).toHaveValue('cia incollato');
});

test('«yy» col fuoco su un punto vuoto, e «yo» battuto in fretta resta «yo»', async ({ app, testServer }) => {
  const url = testServer.html('<title>Video</title><h1>video</h1>');
  await daiLettera(app, 'y', url);
  const page = await casa(app);
  await page.mouse.click(640, 300);
  await page.keyboard.type('yo', { delay: 30 });
  await expect(page.locator('#input')).toHaveValue('yo');
  await page.locator('#input').fill('');
  await page.mouse.click(640, 300);
  await page.keyboard.type('yy', { delay: 40 });
  await expect.poll(() => aperte(app, url), { timeout: 10_000 }).toBe(1);
});

test('la carta Editor trascinata nel «+» ci resta dopo un ricarico e torna; il «+» non si sposta', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await casa(app);
  const editor = page.locator('#tieni .dash-carta[data-tipo="editor"]');
  await expect(editor).toBeVisible();
  await editor.dragTo(page.locator('#altroPiu'));
  await expect(page.locator('#tieni .dash-carta[data-tipo="editor"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#altroPiu')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#tieni .dash-carta[data-tipo="editor"]')).toHaveCount(0);
  await page.locator('#altroPiu').click();
  const nelPiu = page.locator('#altroFuori .dash-altro-app[data-id="editor"]');
  await expect(nelPiu).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/piu-con-editor.png` });
  await page.locator('#altroFuori .dash-altro-cella:has(.dash-altro-app[data-id="editor"]) .dash-altro-rimetti').click();
  await expect(page.locator('#tieni .dash-carta[data-tipo="editor"]')).toHaveCount(1);

  const prima = await inVista(page);
  await page.locator('#altroPiu').dragTo(page.locator('#altro .dash-altro-app[data-id="cerca"]'));
  await expect(page.locator('.dash-altro-griglia.vista .dash-altro-cella:last-child #altroPiu')).toHaveCount(1);
  expect(await inVista(page)).toEqual(prima);
});

test('tutti i tasti nel «+»: la ricerca si apre ancora dal «+», e il «+» resta', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await casa(app);
  for (const id of await inVista(page)) {
    await page.locator(`.dash-altro-griglia.vista .dash-altro-app[data-id="${id}"]`).click({ button: 'right' });
    await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Metti nel «+»' }).click();
    await expect.poll(() => inVista(page)).not.toContain(id);
  }
  await expect(page.locator('#altroPiu')).toBeVisible();
  await page.locator('#altroPiu').click();
  await page.screenshot({ path: `${SHOTS}/piu-tutti.png` });
  await page.locator('#altroFuori .dash-altro-app[data-id="cerca"]').click();
  await expect(page.locator('#cercaInput')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect.poll(() => fuocoId(page)).toBe('input');
});

test('ricerca: il testo con markup resta testo, Esc da un risultato rimette il fuoco nella chat', async ({ app }) => {
  test.setTimeout(60_000);
  await semina(app);
  const page = await casa(app);
  await page.locator('#altro .dash-altro-app[data-id="cerca"]').click();
  await page.keyboard.type('<b>grassetto');
  const voce = page.locator('#cercaRisultati .dash-cerca-msg', { hasText: '<b>grassetto</b>' });
  await expect(voce).toBeVisible();
  await expect(page.locator('#cercaRisultati b')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/ricerca-risultati.png` });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.screenshot({ path: `${SHOTS}/ricerca-risultati-scura.png` });
  await voce.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#cercaFilo')).toBeHidden();
  await expect.poll(() => fuocoId(page)).toBe('input');
  // Riaperta, il campo è vuoto e ha il fuoco.
  await page.locator('#altro .dash-altro-app[data-id="cerca"]').click();
  await expect(page.locator('#cercaInput')).toHaveValue('');
  await expect(page.locator('#cercaInput')).toBeFocused();
});

test('una lettera già data a un sito, ridata a un\'altra cosa, dice cosa apriva prima', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate((_, x) => globalThis.SN_STORAGE.updateSettings({ doppioTocco: { lettere: [{ lettera: 'y', url: 'https://www.youtube.com/' }] } }));
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#doppioToccoLettere .mem-riga')).toHaveCount(1);
  await pref.locator('#doppioToccoNuova').fill('y');
  await pref.locator('#doppioToccoDove').fill('example.com');
  await pref.locator('#doppioToccoAggiungi').click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).doppioTocco.lettere.map((v) => v.url).join())).toBe('https://example.com/');
  await expect.soft(pref.locator('#sec-doppio-tocco')).toContainText('youtube');

  const page = await casa(app);
  await page.locator('#altro .dash-altro-app[data-id="impostazioni"]').click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Assegna una lettera' }).click();
  await page.keyboard.press('y');
  await expect(page.locator('#dashFlash')).toContainText('Impostazioni');
  await expect(page.locator('#dashFlash')).toContainText('example.com');
});

test('i tasti si spostano trascinandoli, e il Profilo torna dal «+» trascinandolo in colonna', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await casa(app);
  await page.locator('#altro .dash-altro-app[data-id="impostazioni"]').dragTo(page.locator('#altro .dash-altro-app[data-id="cerca"]'));
  await expect.poll(() => inVista(page)).toEqual(['impostazioni', 'cerca', 'perDopo', 'scaricamenti', 'cronologia', 'bacheca']);
  await page.locator('#altroPiu').click();
  await page.locator('#altroFuori .dash-altro-app[data-id="profilo"]').dragTo(page.locator('#altro .dash-altro-app[data-id="cerca"]'));
  await expect.poll(() => inVista(page)).toContain('profilo');
  await page.reload();
  await expect(page.locator('#altroPiu')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => inVista(page)).toContain('profilo');
  expect((await inVista(page))[0]).toBe('impostazioni');
});

test('Preferenze: «ww» si assegna e funziona, e togliendola dall\'elenco non fa più niente', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html('<title>W</title><h1>w</h1>');
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.locator('#doppioToccoNuova').fill('w');
  await pref.locator('#doppioToccoDove').fill(url);
  await pref.locator('#doppioToccoAggiungi').click();
  await expect(pref.locator('#doppioToccoLettere .mem-riga')).toHaveCount(1);
  await pref.screenshot({ path: `${SHOTS}/pref-lettere.png`, fullPage: false });
  const page = await casa(app);
  await page.keyboard.type('ww', { delay: 40 });
  await expect.poll(() => aperte(app, url), { timeout: 10_000 }).toBe(1);
  const pref2 = await openTab('filo://preferences/preferences.html');
  const riga = pref2.locator('#doppioToccoLettere .mem-riga').first();
  await riga.locator('button').last().click();
  await expect(pref2.locator('#doppioToccoLettere .mem-riga')).toHaveCount(0);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).doppioTocco.lettere.length)).toBe(0);
});
