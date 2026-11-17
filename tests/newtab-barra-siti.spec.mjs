// #1803 — la barra dei siti della nuova scheda (#1657) e la chat che si ripiega lasciandole il centro (#1662).
// Ogni prova rifà i gesti dell'utente: una scheda trascinata dalla fila diventa una voce che resta al riavvio, si apre
// col clic e si toglie dal tasto destro; la freccia ripiega la chat e la riapre; Filo la cambia a parole; un programma
// messo nella barra parte al clic. Foto (aperta, ripiegata, scura) in tests/.shots/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, ripristina } from './helpers/chatFinta.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '.shots');
const scatta = async (page, nome) => {
  try { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `newtab-barra-siti-${nome}.png`) }); } catch (_) {}
};

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
const attiva = (shell, id) => shell.evaluate((i) => window.filoShell.tabs.activate(i), id);

async function linguetta(shell, id) {
  return shell.evaluate((i) => {
    const r = document.querySelector(`.tab[data-id="${i}"]`).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
}
// Il punto di un elemento della scheda davanti, nei px della barra delle schede.
async function puntoInPagina(app, page, selettore) {
  const r = await page.locator(selettore).first().evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + Math.min(24, b.width / 2), y: b.top + b.height / 2 };
  });
  const v = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { b: t.view.getBounds(), z: t.view.webContents.getZoomFactor() || 1, zs: w.webContents.getZoomFactor() || 1 };
  });
  return { x: (v.b.x + r.x * v.z) / v.zs, y: (v.b.y + r.y * v.z) / v.zs };
}
// Una scheda presa dalla fila col mouse vero e lasciata sulla barra dei siti della home.
async function lasciaSullaBarra(app, shell, page, idScheda) {
  const verso = await puntoInPagina(app, page, '#barraRiga');
  const da = await linguetta(shell, idScheda);
  await shell.mouse.move(da.x, da.y);
  await shell.mouse.down();
  await shell.mouse.move(da.x + 8, da.y, { steps: 2 });
  await shell.mouse.move(verso.x, verso.y, { steps: 8 });
  await shell.mouse.up();
}
// Come le Preferenze: dalla porta delle impostazioni, che le annuncia alle pagine aperte.
const imposta = (page, settings) => page.evaluate((s) => new Promise((ok) => chrome.runtime.sendMessage(
  { type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: s }, ok)), settings);
const salvate = (app) => app.evaluate(async () => (await chrome.storage.local.get('filo_barra_siti')).filo_barra_siti || []);

async function homeConScheda(app, shell, openTab, testServer, titolo) {
  const url = testServer.html(`<title>${titolo}</title><p>${titolo}</p>`);
  await openTab(url);
  const sorgente = (await schede(shell)).find((t) => t.url === url).id;
  const casa = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await attiva(shell, casa.id);
  const page = await home(app);
  return { page, url, sorgente };
}

test('#1657 una scheda trascinata sulla barra diventa una voce: resta al riavvio, il clic apre il sito, il tasto destro la toglie', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const { page, url, sorgente } = await homeConScheda(app, shell, openTab, testServer, 'Ricette di casa');
  await expect(page.locator('#barraSiti .dash-barra-piu')).toBeVisible();

  // (1) Il rilascio sulla barra: la voce col nome della scheda.
  await lasciaSullaBarra(app, shell, page, sorgente);
  const voce = page.locator('#barraSiti .dash-barra-voce[data-tipo="sito"]');
  await expect(voce).toHaveCount(1, { timeout: 5000 });
  await expect(voce).toHaveAttribute('aria-label', 'Ricette di casa');
  await expect(voce).toHaveAttribute('title', `Ricette di casa\n${url}`);
  expect((await salvate(app)).map((v) => v.url)).toEqual([url]);
  // Il campo della chat non ha ricevuto la scheda: è andata dove è stata lasciata.
  await expect(page.locator('.sn-gettoni-fondo .sn-gettone')).toHaveCount(0);
  await scatta(page, 'aperta');

  // (2) Riavvio della pagina: la voce è ancora lì.
  await page.reload();
  const dopo = await home(app);
  await expect(dopo.locator('#barraSiti .dash-barra-voce[data-tipo="sito"]')).toHaveAttribute('aria-label', 'Ricette di casa');

  // (4) Il clic apre il sito in una scheda.
  const quante = async () => (await schede(shell)).filter((t) => t.url === url).length;
  const prima = await quante();
  await dopo.locator('#barraSiti .dash-barra-voce[data-tipo="sito"]').click();
  await expect.poll(quante, { timeout: 8000 }).toBe(prima + 1);

  // (3) Tasto destro → Togli: la voce sparisce, dalla pagina e dal disco; «Rimetti» la riporta.
  const casa = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await attiva(shell, casa.id);
  const p = await home(app);
  await p.locator('#barraSiti .dash-barra-voce[data-tipo="sito"]').click({ button: 'right' });
  const menu = p.locator('.dash-menu');
  await expect(menu.locator('.dash-menu-voce')).toHaveText(['Apri Ricette di casa', 'Rinomina…', 'Copia l\'indirizzo', 'Togli dalla barra']);
  await scatta(p, 'menu-voce');
  await menu.locator('.dash-menu-voce', { hasText: 'Togli dalla barra' }).click();
  await expect(p.locator('#barraSiti .dash-barra-voce[data-tipo="sito"]')).toHaveCount(0);
  await expect.poll(() => salvate(app)).toEqual([]);
  await p.locator('.dash-barra-rimetti').click();
  await expect(p.locator('#barraSiti .dash-barra-voce[data-tipo="sito"]')).toHaveAttribute('aria-label', 'Ricette di casa');
  await expect.poll(async () => (await salvate(app)).map((v) => v.url)).toEqual([url]);
});

test('#1657 dal tasto destro e dal «+»: aggiungi un sito scritto a mano, rinominalo, riordina e togli trascinando fuori', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  // «Aggiungi sito…» dal tasto destro sulla barra vuota.
  await page.locator('#barraSiti').click({ button: 'right', position: { x: 200, y: 10 } });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Aggiungi sito…' }).click();
  await page.locator('.dash-barra-campo input').fill('wikipedia.org');
  await page.keyboard.press('Enter');
  await expect(page.locator('#barraSiti .dash-barra-voce[data-tipo="sito"]')).toHaveAttribute('aria-label', 'wikipedia.org');
  // Dal «+»; un indirizzo che non è un sito resta fuori e lo dice.
  await page.locator('#barraSiti .dash-barra-piu').click();
  await page.locator('.dash-barra-campo input').fill('javascript:alert(1)');
  await page.keyboard.press('Enter');
  await expect(page.locator('#dashFlash')).toContainText('non è l\'indirizzo di un sito');
  await page.locator('#barraSiti .dash-barra-piu').click();
  await page.locator('.dash-barra-campo input').fill('example.org');
  await page.keyboard.press('Escape');
  await expect(page.locator('.dash-barra-campo')).toHaveCount(0);
  await page.locator('#barraSiti .dash-barra-piu').click();
  await page.locator('.dash-barra-campo input').fill('example.org');
  await page.keyboard.press('Enter');
  const etichette = () => page.locator('#barraSiti .dash-barra-voce[data-tipo]').evaluateAll((l) => l.map((n) => n.getAttribute('aria-label')));
  await expect.poll(etichette).toEqual(['wikipedia.org', 'example.org']);

  // Rinomina dal tasto destro: un nome con markup resta testo.
  await page.locator('#barraSiti .dash-barra-voce[aria-label="example.org"]').click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Rinomina…' }).click();
  await page.locator('.dash-barra-campo input').fill('<b>Esempio</b>');
  await page.keyboard.press('Enter');
  await expect.poll(etichette).toEqual(['wikipedia.org', '<b>Esempio</b>']);
  await expect(page.locator('#barraSiti b')).toHaveCount(0);

  // Riordino trascinando l'una prima dell'altra.
  await page.locator('#barraSiti .dash-barra-voce[aria-label="<b>Esempio</b>"]').dragTo(page.locator('#barraSiti .dash-barra-voce[aria-label="wikipedia.org"]'), { targetPosition: { x: 3, y: 10 } });
  await expect.poll(etichette).toEqual(['<b>Esempio</b>', 'wikipedia.org']);
  await expect.poll(async () => (await salvate(app)).map((v) => v.nome)).toEqual(['<b>Esempio</b>', 'wikipedia.org']);

  // Trascinata fuori dalla barra, sul fondo della pagina: tolta.
  await page.locator('#barraSiti .dash-barra-voce[aria-label="wikipedia.org"]').dragTo(page.locator('#center'), { targetPosition: { x: 40, y: 60 } });
  await expect.poll(etichette).toEqual(['<b>Esempio</b>']);
  await expect(page.locator('.dash-barra-rimetti')).toContainText('wikipedia.org');
});

test('#1662 la freccia ripiega la chat: resta il campo, al centro la barra; resta al riavvio; scrivere la riapre', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await app.evaluate(async () => {
    await chrome.storage.local.set({ filo_barra_siti: [
      { id: 'a', tipo: 'sito', url: 'https://www.wikipedia.org/', nome: 'Wikipedia', icona: '' },
      { id: 'b', tipo: 'sito', url: 'https://www.youtube.com/', nome: 'YouTube', icona: '' },
      { id: 'c', tipo: 'sito', url: 'https://maps.example.org/', nome: 'Mappe di un nome molto lungo che non ci sta', icona: '' },
    ] });
  });
  await page.reload();
  let p = await home(app);
  const freccia = p.locator('#ripiegaChat');
  await expect(freccia).toHaveAttribute('title', 'Ripiega la chat');
  await expect(p.locator('#threadView')).toBeVisible();

  // (5) Clic: la conversazione non si vede, il campo sì, la barra sì (col nome sotto ogni icona).
  await freccia.click();
  await expect(p.locator('#threadView')).toBeHidden();
  await expect(p.locator('#input')).toBeVisible();
  await expect(p.locator('#barraSiti .dash-barra-voce[aria-label="Wikipedia"] .dash-barra-nome')).toBeVisible();
  await expect(freccia).toHaveAttribute('title', 'Riapri la chat');
  await scatta(p, 'ripiegata');

  // (6) Riavvio: resta ripiegata.
  await p.reload();
  p = await home(app);
  await expect(p.locator('#threadView')).toBeHidden();
  await expect(p.locator('#barraSiti .dash-barra-voce[aria-label="YouTube"]')).toBeVisible();

  // Tema scuro, ripiegata.
  await imposta(p, { theme: 'dark' });
  await expect(p.locator('html')).toHaveAttribute('data-sn-theme', 'dark');
  await scatta(p, 'ripiegata-scura');
  await imposta(p, { theme: 'light' });

  // (7) Clic di nuovo: la conversazione torna.
  await p.locator('#ripiegaChat').click();
  await expect(p.locator('#threadView')).toBeVisible();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).chatRipiegata)).toBe(false);

  // Ripiegata e scrivo: la chat si riapre e la risposta si vede.
  await p.locator('#ripiegaChat').click();
  await expect(p.locator('#threadView')).toBeHidden();
  await modelloFinto(app, [{ text: 'Eccomi, ti sento.' }]);
  try {
    await p.locator('#input').fill('ci sei?');
    await p.locator('#sendBtn').click();
    await expect(p.locator('#threadView')).toBeVisible();
    await expect(p.locator('.dash-bubble-filo', { hasText: 'Eccomi, ti sento.' })).toBeVisible({ timeout: 10_000 });
  } finally { await ripristina(app); }
});

test('#1657 #1662 a parole: Filo mette un sito nella barra e ripiega la chat, dalle stesse porte dei gesti', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'b1', name: 'BARRA_SITI', arguments: JSON.stringify({ operazione: 'aggiungi', elemento: 'youtube.com', nome: 'YouTube' }) }] },
    { text: 'Fatto, YouTube è nella barra.' },
    { toolCalls: [{ id: 'b2', name: 'BARRA_SITI', arguments: JSON.stringify({ operazione: 'ripiega' }) }] },
    { text: 'Ripiegata.' },
  ]);
  try {
    await page.locator('#input').fill('metti youtube nella barra');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'YouTube è nella barra' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#barraSiti .dash-barra-voce[aria-label="YouTube"]')).toBeVisible();
    expect((await salvate(app)).map((v) => v.url)).toEqual(['https://youtube.com/']);
    // Ripiegare chiesto a Filo è la stessa impostazione della freccia; la risposta arrivata intanto accende la freccia.
    await page.locator('#input').fill('ripiega la chat');
    await page.locator('#sendBtn').click();
    await expect(page.locator('#threadView')).toBeHidden({ timeout: 10_000 });
    await expect(page.locator('#ripiegaChat')).toHaveAttribute('data-nuovo', '1');
    expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).chatRipiegata)).toBe(true);
  } finally { await ripristina(app); }
  // Nascondere la barra dalle Preferenze la toglie dalla home.
  await imposta(page, { barraSiti: { visibile: false }, chatRipiegata: false });
  await expect(page.locator('#barraSiti')).toBeHidden();
  await expect(page.locator('#threadView')).toBeVisible();
  await expect(page.locator('#ripiegaChat')).toBeVisible();
});

test('#1657 un programma del computer nella barra parte al clic', async ({ app }) => {
  test.skip(process.platform === 'win32', 'il programma di prova è uno script di shell');
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('barra-siti-app');
  const segno = path.join(dir, 'partito.txt');
  const gioco = path.join(dir, 'Gioco');
  fs.writeFileSync(gioco, `#!/bin/sh\necho ok > "${segno}"\n`);
  fs.chmodSync(gioco, 0o755);
  const page = await home(app);
  // Il rilascio di un file vero dal desktop arriva alla pagina come percorso: qui la stessa mossa che manda la barra.
  const r = await page.evaluate((percorso) => new Promise((ok) => chrome.runtime.sendMessage(
    { type: window.SN_MSG.MSG.BARRA_SITI_MODIFICA, mossa: { tipo: 'aggiungi', percorso } }, ok)), gioco);
  expect(r.ok, r.error).toBe(true);
  const voce = page.locator('#barraSiti .dash-barra-voce[data-tipo="app"]');
  await expect(voce).toHaveAttribute('aria-label', 'Gioco');
  await voce.click();
  await expect.poll(() => fs.existsSync(segno), { timeout: 10_000 }).toBe(true);
  // Un percorso mandato al posto dell'id non parte.
  const no = await page.evaluate((percorso) => new Promise((ok) => chrome.runtime.sendMessage(
    { type: window.SN_MSG.MSG.BARRA_SITI_AVVIA, id: percorso }, ok)), gioco);
  expect(no.ok).toBe(false);
});
