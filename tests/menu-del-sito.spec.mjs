// #975 — Sui siti con un menu del tasto destro tutto loro (Docs, Figma…) il menu di Filo ha in cima «Menu di <sito>»,
// che apre quello del sito nello stesso punto; scelto spesso, Filo propone una volta di aprirlo subito col tasto destro,
// e accettato il menu di Filo resta a Shift. Una pagina senza menu suo non ha la voce.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const MENU_SUO = `<!doctype html><html><head><meta charset="utf-8">
<meta property="og:site_name" content="Sito di prova"><title>Menu proprio</title>
<style>#menu-suo { position: fixed; width: 160px; height: 120px; background: #eee; border: 1px solid #999 }</style>
<script>
  window.aperture = 0;
  document.addEventListener('contextmenu', function (e) {
    if (e.target.closest && e.target.closest('#libero')) return;
    e.preventDefault();
    var m = document.getElementById('menu-suo');
    m.style.left = e.clientX + 'px';
    m.style.top = e.clientY + 'px';
    m.hidden = false;
    window.aperture++;
  });
  // Come i menu veri: un clic altrove lo chiude. Anche il clic sulla voce di Filo, se il menu nascesse dentro quel clic.
  document.addEventListener('click', function () { document.getElementById('menu-suo').hidden = true; });
</script></head>
<body style="margin:0;padding:40px;font:16px sans-serif">
  <div id="area" style="width:420px;height:220px;background:#cde">la tela del sito</div>
  <p id="libero" style="width:420px">qui il sito lascia il menu del browser</p>
  <div id="menu-suo" hidden>menu del sito</div>
</body></html>`;

const SENZA_MENU = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <p id="testo">Una pagina qualunque, senza un menu suo.</p>
</body></html>`;

// La radice di React si iscrive a tutti gli eventi: senza un onContextMenu sul cammino non è un menu.
const COME_REACT = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <div id="root">
    <p id="senza" style="width:300px">testo dentro l'app</p>
    <p id="con" style="width:300px">riga col menu dell'app</p>
  </div>
  <script>
    var r = document.getElementById('root');
    r._reactListeningab12 = true;
    r.__reactContainer$ab12 = {};
    r.addEventListener('contextmenu', function () {}, false);
    r.addEventListener('contextmenu', function () {}, true);
    document.getElementById('senza').__reactProps$ab12 = { children: 'testo' };
    document.getElementById('con').__reactProps$ab12 = { onContextMenu: function () {} };
  </script>
</body></html>`;

// Blocca il tasto destro e basta: nessun menu.
const SOLO_BLOCCO = `<!doctype html><html><head><script>
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
</script></head><body style="padding:40px;font:16px sans-serif">
  <p id="testo" style="width:300px">Il tasto destro qui è bloccato.</p>
</body></html>`;

const riservaAperta = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .some((x) => !x.isDestroyed() && x.isVisible() && x.webContents.getURL().startsWith('data:text/html')));
const sitiScelti = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).menuDelSito.siti);

async function primaVoce(page) {
  const menu = menuDi(page).locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  return (await menu.locator('button .sn-menu-label').first().innerText()).trim();
}

// La scelta arriva alla scheda con la spinta delle impostazioni: si riprova finché il tasto destro non apre `atteso`.
async function tastoDestroApre(page, atteso) {
  await expect(async () => {
    await page.keyboard.press('Escape');
    await page.mouse.click(600, 500);
    await page.locator('#area').click({ button: 'right', position: { x: 30, y: 30 } });
    await expect(atteso).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

async function scegliMenuDelSito(page, dove = '#area') {
  await page.locator(dove).click({ button: 'right', position: { x: 60, y: 50 } });
  const voce = menuDi(page).locator('.sn-menu .sn-menu-split-main', { hasText: 'Menu di Sito di prova' });
  await expect(voce).toBeVisible();
  await voce.click();
}

test('«Menu di <sito>» in cima apre il menu della pagina nello stesso punto, e il clic sulla voce non lo richiude', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, MENU_SUO);
  await page.locator('#area').click({ button: 'right', position: { x: 60, y: 50 } });
  expect(await primaVoce(page)).toBe('Menu di Sito di prova');
  // Il sito non ha visto il tasto destro che ha aperto il menu di Filo.
  expect(await page.evaluate(() => window.aperture)).toBe(0);

  await menuDi(page).locator('.sn-menu .sn-menu-split-main', { hasText: 'Menu di Sito di prova' }).click();
  await expect(page.locator('#menu-suo')).toBeVisible();
  await expect(menuDi(page).locator('.sn-menu')).toHaveCount(0);
  const posto = await page.evaluate(() => {
    const r = document.getElementById('menu-suo').getBoundingClientRect();
    const a = document.getElementById('area').getBoundingClientRect();
    return { dx: Math.round(r.left - (a.left + 60)), dy: Math.round(r.top - (a.top + 50)) };
  });
  expect(posto).toEqual({ dx: 0, dy: 0 });
  await page.waitForTimeout(400);
  expect(await riservaAperta(app)).toBe(false);
});

const vociDelSito = (page) => menuDi(page).locator('.sn-menu .sn-menu-split-main', { hasText: /^Menu di/ });

// L'altra porta standard per ascoltare il tasto destro: il gestore oncontextmenu, da script o come attributo.
const COL_GESTORE = (registra, attributo) => MENU_SUO
  .replace("document.addEventListener('contextmenu', function (e) {", 'window.mostra = function (e) {')
  .replace("    window.aperture++;\n  });", `    window.aperture++;\n    return false;\n  };\n  ${registra}`)
  .replace('<div id="area"', `<div id="area" ${attributo}`);

for (const [nome, registra, attributo] of [
  ['assegnato da script', 'document.oncontextmenu = function (e) { return mostra(e); };', ''],
  ['scritto come attributo', '', 'oncontextmenu="return mostra(event)"'],
]) {
  test(`un menu col gestore oncontextmenu ${nome}: la voce c'è e apre il menu della pagina`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, COL_GESTORE(registra, attributo));
    await page.locator('#area').click({ button: 'right', position: { x: 60, y: 50 } });
    await expect(vociDelSito(page)).toHaveText(['Menu di Sito di prova']);
    expect(await page.evaluate(() => window.aperture)).toBe(0);
    await vociDelSito(page).click();
    await expect(page.locator('#menu-suo')).toBeVisible();
  });
}

// Anche gli strumenti di Playwright ascoltano il tasto destro sulla finestra della pagina, con un ascoltatore solo per
// dodici eventi: come un registratore di sessione, non sono un menu, e queste prove lo verificano di passaggio.
test('una pagina senza menu suo, o un\'app React senza onContextMenu, non ha la voce; con onContextMenu sì', async ({ openTab, testServer }) => {
  const semplice = await testServer.openReady(openTab, SENZA_MENU);
  await semplice.locator('#testo').click({ button: 'right' });
  await expect(menuDi(semplice).locator('.sn-menu')).toBeVisible();
  await expect(vociDelSito(semplice)).toHaveCount(0);

  // Un altro host: le schede si ritrovano per host.
  const react = await testServer.openReady(openTab, COME_REACT, { pubblico: true });
  await react.locator('#senza').click({ button: 'right' });
  await expect(menuDi(react).locator('.sn-menu')).toBeVisible();
  await expect(vociDelSito(react)).toHaveCount(0);
  await react.keyboard.press('Escape');
  await react.locator('#con').click({ button: 'right' });
  await expect(vociDelSito(react)).toHaveText(['Menu di sito-pubblico.test']);
});

test('su un sito che blocca il tasto destro senza un menu suo, la voce apre quello del browser e poi sparisce', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SOLO_BLOCCO);
  await page.locator('#testo').click({ button: 'right' });
  await expect(vociDelSito(page)).toHaveText(['Menu di 127.0.0.1']);
  await vociDelSito(page).click();
  await expect.poll(() => riservaAperta(app), { timeout: 5000 }).toBe(true);
  await page.keyboard.press('Escape');
  await page.locator('#testo').click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu')).toBeVisible();
  await expect(vociDelSito(page)).toHaveCount(0);
});

test('scelto tre volte, Filo propone una volta il menu del sito; accettato, il tasto destro apre quello e Shift quello di Filo', async ({ app, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, MENU_SUO, { pubblico: true });
  for (let i = 1; i <= 3; i++) {
    await scegliMenuDelSito(page);
    await expect(page.locator('#menu-suo')).toBeVisible();
    await page.mouse.click(600, 500);
    await expect(page.locator('#menu-suo')).toBeHidden();
  }
  const vista = await avvisi();
  const proposta = vista.locator('.shell-notif.show', { hasText: 'sito-pubblico.test' });
  await expect(proposta).toBeVisible({ timeout: 10_000 });
  await expect(proposta).toContainText('Shift + tasto destro');
  await proposta.locator('.shell-notif-action', { hasText: 'Sì' }).click();
  await expect.poll(() => sitiScelti(app)).toEqual(['sito-pubblico.test']);
  await expect(vista.locator('.shell-notif.show', { hasText: 'Annulla' })).toBeVisible();

  // Il tasto destro adesso va al sito.
  await tastoDestroApre(page, page.locator('#menu-suo'));
  await page.waitForTimeout(300);
  await expect(menuDi(page).locator('.sn-menu')).toHaveCount(0);
  await page.mouse.click(600, 500);

  // Dove il sito non annulla, il tasto destro apre comunque il menu di Filo.
  await page.locator('#libero').click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu')).toBeVisible();
  await page.keyboard.press('Escape');

  // Shift porta al menu di Filo, che dalla freccia della voce rimette le cose com'erano.
  const prima = await page.evaluate(() => window.aperture);
  await page.keyboard.down('Shift');
  await page.locator('#area').click({ button: 'right', position: { x: 30, y: 30 } });
  await page.keyboard.up('Shift');
  expect(await primaVoce(page)).toBe('Menu di Sito di prova');
  expect(await page.evaluate(() => window.aperture)).toBe(prima);
  await menuDi(page).locator('.sn-menu .sn-menu-split-arrow').first().hover();
  await menuDi(page).locator('.sn-menu-sub .sn-menu-item', { hasText: 'Col tasto destro apri il menu di Filo' }).click();
  await expect.poll(() => sitiScelti(app)).toEqual([]);
  await tastoDestroApre(page, menuDi(page).locator('.sn-menu'));
  expect(await page.evaluate(() => window.aperture)).toBe(prima);

  // La proposta non torna: una volta per sito.
  await page.keyboard.press('Escape');
  await scegliMenuDelSito(page);
  await page.waitForTimeout(500);
  await expect(vista.locator('.shell-notif.show', { hasText: 'scegli spesso' })).toHaveCount(0);
});

test('la scelta si fa anche dalla freccia della voce, e si toglie dalle Preferenze', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, MENU_SUO, { pubblico: true });
  await page.locator('#area').click({ button: 'right' });
  await menuDi(page).locator('.sn-menu .sn-menu-split-arrow').first().hover();
  await menuDi(page).locator('.sn-menu-sub .sn-menu-item', { hasText: 'Aprilo subito col tasto destro' }).click();
  await expect.poll(() => sitiScelti(app)).toEqual(['sito-pubblico.test']);
  await tastoDestroApre(page, page.locator('#menu-suo'));

  const pref = await openTab('filo://preferences/preferences.html');
  const riga = pref.locator('#menuDelSitoSiti .mem-riga', { hasText: 'sito-pubblico.test' });
  await expect(riga).toBeVisible();
  await riga.hover();
  await riga.locator('.mem-via').click();
  await expect.poll(() => sitiScelti(app)).toEqual([]);
  await expect(pref.locator('#menuDelSitoSiti')).toContainText('Nessun sito');
});

test('un sito sceglie solo per sé: il sito lo ricava il main dal frame, mai dal messaggio', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const web = { url: 'https://evil.example/pagina', tab: { id: 1, url: 'https://evil.example/pagina' }, frame: { url: 'https://evil.example/pagina' } };
    const imposta = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.MENU_DEL_SITO_IMPOSTA, attivo: true, sito: 'docs.google.com' }, web);
    const daFilo = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.MENU_DEL_SITO_IMPOSTA, attivo: true, sito: 'figma.com' }, { url: 'filo://shell/shell.html', isShell: true });
    const sceltoDaFilo = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.MENU_DEL_SITO_SCELTO }, { url: 'filo://shell/shell.html', isShell: true });
    return { imposta, daFilo, sceltoDaFilo, siti: (await globalThis.SN_STORAGE.getSettings()).menuDelSito.siti };
  });
  expect(r.imposta.sito).toBe('evil.example');
  expect(r.daFilo.sito).toBe('figma.com');
  expect(r.sceltoDaFilo.ok).toBe(false);
  expect(r.siti).toEqual(['evil.example', 'figma.com']);
});
