// #1803 — la barra dei siti della nuova scheda (#1657) e la chat che si ripiega lasciandole il centro (#1662).
// Ogni prova rifà i gesti dell'utente: una scheda trascinata dalla fila diventa una voce che resta al riavvio, si apre
// col clic e si toglie dal tasto destro; la freccia ripiega la chat e la riapre; Filo la cambia a parole; un programma
// messo nella barra parte al clic. Foto (aperta, ripiegata, scura) in tests/.shots/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina } from './helpers/chatFinta.mjs';
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
  // A icone (#2555): le stesse voci, ogni icona seguita dalle varianti del suo verbo.
  const menu = menuDi(p);
  await expect(menu.principale).toBeVisible();
  expect(await menu.vociScritte()).toEqual(['Apri Ricette di casa', 'Rinomina…', 'Copia l\'indirizzo', 'Togli dalla barra']);
  await scatta(p, 'menu-voce');
  await menu.scegli('Togli dalla barra');
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
  await menuDi(page).scegli('Aggiungi sito…');
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
  await menuDi(page).scegli('Rinomina…');
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

// La riga la scrive la home mentre Filo lavora, coi moduli che la pagina carica: qui, non nel main, si legge il sinonimo.
test('#1803.2 nella chat della home la riga dice cosa è successo alla barra: messo, già lì, letta, tolto, ripiegata', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  const metti = { operazione: 'metti', elemento: 'youtube.com', nome: 'YouTube' };
  const turni = [
    ['metti youtube nella barra', metti, 'Messo nella barra dei siti · YouTube'],
    ['rimettilo', metti, 'È già nella barra dei siti · YouTube'],
    ['cosa c\'è nella barra?', { operazione: 'leggi' }, 'Letta la barra dei siti'],
    ['toglilo', { operazione: 'rimuovi', elemento: 'YouTube' }, 'Tolto dalla barra dei siti · YouTube'],
    ['ripiega la chat', { operazione: 'ripiega' }, 'Chat della home ripiegata'],
  ];
  await modelloFinto(app, turni.flatMap(([, args], i) => [
    { toolCalls: [{ id: `r${i}`, name: 'BARRA_SITI', arguments: JSON.stringify(args) }] },
    { text: `Risposta ${i}.` },
  ]));
  try {
    for (const [i, [chiesto, , riga]] of turni.entries()) {
      await page.locator('#input').fill(chiesto);
      await page.locator('#sendBtn').click();
      await expect(page.locator('.dash-bubble-filo', { hasText: `Risposta ${i}.` })).toHaveCount(1, { timeout: 10_000 });
      await expect(page.locator('#bubbles')).toContainText(riga);
    }
    await expect(page.locator('#threadView')).toBeHidden();
    await page.locator('#ripiegaChat').click();
    await expect(page.locator('#bubbles')).not.toContainText('Barra dei siti · ');
    await scatta(page, 'righe-chat');
  } finally { await ripristina(app); }
});

// La riga, il riassunto del blocco e l'esito che torna a Filo leggono tutti l'esito della mossa, anche da riaperta.
test('#1803.2 una mossa a parole che lascia la barra com\'era: né la riga, né il riassunto, né Filo la dicono fatta', async ({ app }) => {
  test.setTimeout(120_000);
  let page = await home(app);
  await app.evaluate(async () => {
    await chrome.storage.local.set({ filo_barra_siti: [
      { id: 'yt', tipo: 'sito', url: 'https://youtube.com/', nome: 'YouTube', icona: '' },
      { id: 'gm', tipo: 'sito', url: 'https://mail.google.com/', nome: 'Gmail', icona: '' },
    ] });
  });
  await page.reload();
  page = await home(app);
  const turni = [
    ['rinomina YouTube in YouTube', { operazione: 'rinomina', elemento: 'YouTube', nome: 'YouTube' }, 'Ha già quel nome nella barra dei siti · YouTube'],
    ['sposta YouTube in cima', { operazione: 'sposta', elemento: 'YouTube', verso: 'cima' }, 'È già a quel posto nella barra dei siti · YouTube'],
    ['rimetti youtube nella barra', { operazione: 'aggiungi', elemento: 'youtube.com', nome: 'Tubo' }, 'È già nella barra dei siti · YouTube'],
    ['rinomina YouTube in Video', { operazione: 'rinomina', elemento: 'YouTube', nome: 'Video' }, 'Rinominato nella barra dei siti · Video'],
  ];
  await modelloFinto(app, turni.flatMap(([, args], i) => [
    { toolCalls: [{ id: `v${i}`, name: 'BARRA_SITI', arguments: JSON.stringify(args) }] },
    { text: `Risposta ${i}.` },
  ]));
  let esiti = [];
  try {
    for (const [i, [chiesto, , riga]] of turni.entries()) {
      await page.locator('#input').fill(chiesto);
      await page.locator('#sendBtn').click();
      await expect(page.locator('.dash-bubble-filo', { hasText: `Risposta ${i}.` })).toHaveCount(1, { timeout: 15_000 });
      await expect(page.locator('#bubbles')).toContainText(riga);
    }
    // A blocco chiuso resta il riassunto: «Ha sistemato» solo dove la barra è cambiata davvero.
    await expect(page.locator('#bubbles')).not.toContainText('Messo nella barra');
    await expect.poll(() => page.locator('#bubbles').innerText().then((t) => (t.match(/Ha sistemato la barra dei siti/g) || []).length)).toBe(1);
    expect((await salvate(app)).map((v) => v.nome)).toEqual(['Video', 'Gmail']);
    await page.locator('.dash-activity-head').first().click().catch(() => {});
    await scatta(page, 'gia-cosi');
    esiti =(await chiamateAlModello(app)).at(-1).filter((m) => m.role === 'tool').map((m) => String(m.content));
  } finally { await ripristina(app); }
  expect(esiti).toHaveLength(4);
  for (const e of esiti.slice(0, 3)) expect(e).toMatch(/^Non cambiato niente: /);
  expect(esiti[2]).toContain('È già nella barra dei siti');
  expect(esiti[3]).toMatch(/^Eseguita: Rinominato/);

  // Riaperta, le mosse senza effetto restano non fatte, come «Sei già nella home» (#553.15): la riga detta in diretta,
  // con la sua icona e senza l'avviso di un guasto; il modello le rilegge come non fatte.
  const chat = (await app.evaluate(() => globalThis.SN_FILO_CHATS.list()))
    .find((c) => !c.app && c.messages.some((m) => m.text === 'rinomina YouTube in YouTube'));
  expect(chat).toBeTruthy();
  const archiviate = chat.messages.filter((m) => m.role !== 'user').flatMap((m) => m.esiti || [])
    .filter((v) => v.type === 'BARRA_SITI');
  expect(archiviate.map((v) => [v.esito, v.senzaEffetto === true])).toEqual([
    ['fallito', true], ['fallito', true], ['fallito', true], ['fatto', false],
  ]);
  const perModello = await app.evaluate((_e, v) => globalThis.SN_ESITO.perModello(v), archiviate);
  expect((String(perModello).match(/NON fatta, non ha cambiato niente/g) || []).length).toBe(3);
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
  for (const [, , riga] of turni) await expect(page.locator('#bubbles')).toContainText(riga, { timeout: 10_000 });
  for (const [, , riga] of turni.slice(0, 3)) {
    const r = page.locator('.dash-esiti-archiviati .dash-activity-row', { hasText: riga });
    await expect(r).toHaveCount(1);
    await expect(r.locator('.dash-activity-row-icon')).toHaveText('📌');
    await expect(r).not.toContainText(/non riuscit|⚠/i);
  }
  const testo = await page.locator('#bubbles').innerText();
  expect((testo.match(/Ha sistemato la barra dei siti/g) || []).length).toBeLessThanOrEqual(1);
  expect(testo).not.toContain('Messo nella barra');
});

test('#1657 tante voci si raggiungono tutte; Canc toglie; trascinata nel campo scrive l\'indirizzo; il tasto destro nasconde la barra', async ({ app }) => {
  test.setTimeout(60_000);
  let page = await home(app);
  await app.evaluate(async () => {
    const voci = Array.from({ length: 40 }, (_, i) => ({ id: `v${i}`, tipo: 'sito', url: `https://sito${i}.example.org/`, nome: `Sito ${i}`, icona: '' }));
    await chrome.storage.local.set({ filo_barra_siti: voci });
  });
  await page.reload();
  page = await home(app);
  const barra = page.locator('#barraSiti');
  await expect(barra.locator('.dash-barra-voce[data-tipo]')).toHaveCount(40);
  // La rotella porta la fila di lato fino all'ultima voce.
  await barra.hover();
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 400);
  await expect.poll(() => barra.evaluate((b) => b.scrollLeft)).toBeGreaterThan(0);
  await expect(barra.locator('.dash-barra-voce[aria-label="Sito 39"]')).toBeInViewport();

  // Canc sulla voce col fuoco la toglie.
  await barra.locator('.dash-barra-voce[aria-label="Sito 39"]').focus();
  await page.keyboard.press('Delete');
  await expect(barra.locator('.dash-barra-voce[aria-label="Sito 39"]')).toHaveCount(0);
  await expect.poll(async () => (await salvate(app)).length).toBe(39);

  // Trascinata nel campo di scrittura: ci scrive l'indirizzo, e resta nella barra.
  await barra.locator('.dash-barra-voce[aria-label="Sito 0"]').scrollIntoViewIfNeeded();
  await barra.locator('.dash-barra-voce[aria-label="Sito 0"]').dragTo(page.locator('#input'));
  await expect(page.locator('#input')).toHaveValue(/https:\/\/sito0\.example\.org\//);
  await expect(barra.locator('.dash-barra-voce[aria-label="Sito 0"]')).toHaveCount(1);

  // Tasto destro sulla barra: «Nascondi la barra» la toglie dalla home e dalle Preferenze.
  await page.locator('#barraSiti .dash-barra-piu').click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Nascondi la barra' }).click();
  await expect(barra).toBeHidden();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).barraSiti.visibile)).toBe(false);
});

// Un file vero del disco, lasciato sulla barra come lo lascia il desktop: il File arriva da un campo di scelta (lo
// stesso oggetto col suo percorso che dà il sistema), il rilascio passa dal gestore della pagina.
async function lasciaFileSullaBarra(page, percorso) {
  await page.evaluate(() => {
    const i = Object.assign(document.createElement('input'), { type: 'file', id: '__fileDelDesktop' });
    i.style.display = 'none';
    document.body.appendChild(i);
  });
  await page.setInputFiles('#__fileDelDesktop', percorso);
  await page.evaluate(() => {
    const campo = document.getElementById('__fileDelDesktop');
    const dt = new DataTransfer();
    dt.items.add(campo.files[0]);
    campo.remove();
    const riga = document.getElementById('barraRiga');
    const r = riga.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 40, clientY: r.top + r.height / 2 };
    riga.dispatchEvent(new DragEvent('dragover', o));
    riga.dispatchEvent(new DragEvent('drop', o));
  });
}
// Un collegamento trascinato da un'altra finestra (un altro browser, un documento): arriva come text/uri-list.
const lasciaCollegamento = (page, url) => page.evaluate((u) => {
  const dt = new DataTransfer();
  dt.setData('text/uri-list', `# commento\n${u}`);
  const riga = document.getElementById('barraRiga');
  const r = riga.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 40, clientY: r.top + r.height / 2 };
  riga.dispatchEvent(new DragEvent('dragover', o));
  riga.dispatchEvent(new DragEvent('drop', o));
}, url);

test('#1657 un programma del computer lasciato sulla barra dal desktop parte al clic', async ({ app }) => {
  test.skip(process.platform === 'win32', 'il programma di prova è uno script di shell: Windows e Mac li provano gli unit');
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('barra-siti-app');
  const segno = path.join(dir, 'partito.txt');
  const gioco = path.join(dir, 'Gioco');
  fs.writeFileSync(gioco, `#!/bin/sh\necho ok > "${segno}"\n`);
  fs.chmodSync(gioco, 0o755);
  const page = await home(app);
  await lasciaFileSullaBarra(page, gioco);
  await expect.poll(async () => (await salvate(app)).map((v) => v.percorso)).toEqual([gioco]);
  const voce = page.locator('#barraSiti .dash-barra-voce[data-tipo="app"]');
  await expect(voce).toHaveAttribute('aria-label', 'Gioco');
  await voce.click();
  await expect.poll(() => fs.existsSync(segno), { timeout: 10_000 }).toBe(true);
  // Un percorso mandato al posto dell'id non parte.
  const no = await page.evaluate((percorso) => new Promise((ok) => chrome.runtime.sendMessage(
    { type: window.SN_MSG.MSG.BARRA_SITI_AVVIA, id: percorso }, ok)), gioco);
  expect(no.ok).toBe(false);
  // Un file che non è un programma resta fuori, e lo dice.
  const nota = path.join(dir, 'nota.txt');
  fs.writeFileSync(nota, 'ciao');
  await lasciaFileSullaBarra(page, nota);
  await expect(page.locator('#dashFlash')).toContainText('programma');
  expect((await salvate(app)).length).toBe(1);
});

test('#1803.1 un collegamento lasciato da un\'altra finestra diventa una voce', async ({ app, testServer }) => {
  test.setTimeout(45_000);
  const page = await home(app);
  const url = testServer.html('<title>Da fuori</title><p>x</p>');
  await lasciaCollegamento(page, url);
  await expect(page.locator(`#barraSiti .dash-barra-voce[title$="${url}"]`)).toHaveCount(1);
  expect((await salvate(app)).map((v) => v.url)).toEqual([url]);
});

test('#1803.1 la Cronologia trascinata sulla barra entra; di nuovo, la voce si illumina e lo dice; una scheda che non è un sito resta fuori e lo dice', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await openTab('filo://history/history.html');
  const cron = (await schede(shell)).find((t) => String(t.url).startsWith('filo://history'));
  const casa = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await attiva(shell, casa.id);
  const page = await home(app);

  await lasciaSullaBarra(app, shell, page, cron.id);
  const voce = page.locator('#barraSiti .dash-barra-voce[data-tipo="sito"]');
  await expect(voce).toHaveCount(1, { timeout: 5000 });
  await expect(voce).toHaveAttribute('aria-label', /Cronologia/);
  // Le pagine di Filo hanno tutte la stessa icona: la voce mostra la lettera del suo nome.
  await expect(voce.locator('.dash-barra-lettera')).toHaveText('C');
  expect((await salvate(app)).map((v) => v.url)).toEqual(['filo://history/history.html']);

  // Di nuovo la stessa: nessuna voce in più, quella che c'è si fa vedere e l'avviso lo dice.
  await lasciaSullaBarra(app, shell, page, cron.id);
  await expect(page.locator('#dashFlash')).toContainText('è già nella barra');
  await expect(voce).toHaveClass(/dash-trovato/);
  await scatta(page, 'gia-nella-barra');
  await expect(voce).toHaveCount(1);

  // Il clic porta alla Cronologia (una sola scheda per pagina di Filo: torna davanti quella aperta).
  const davanti = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    return w._filoTabs.activeId;
  });
  await voce.click();
  await expect.poll(davanti, { timeout: 8000 }).toBe(cron.id);

  // Una scheda che non è né un sito né una pagina di Filo (qui una vuota, come la consegna il main): resta fuori e lo dice.
  await attiva(shell, casa.id);
  const p = await home(app);
  await p.evaluate(() => {
    const r = document.getElementById('barraRiga').getBoundingClientRect();
    window.SN_SCHEDA_TRASCINATA.ricevi({ fase: 'lascia', x: r.left + 40, y: r.top + r.height / 2, scheda: { id: 'x', titolo: 'Vuota', url: 'about:blank', icona: '' } });
  });
  await expect(p.locator('#dashFlash')).toContainText('«about:blank» non è l\'indirizzo di un sito');
  expect((await salvate(app)).length).toBe(1);
});

test('#1803.1 un server locale scritto nel «+» si apre in http, come dalla navigazione', async ({ app, shell, testServer }) => {
  test.setTimeout(45_000);
  const page = await home(app);
  const url = testServer.html('<title>Server di sviluppo</title><p>in locale</p>');
  const scritto = url.replace(/^http:\/\//, '');
  await page.locator('#barraSiti .dash-barra-piu').click();
  await page.locator('.dash-barra-campo input').fill(scritto);
  await page.keyboard.press('Enter');
  const voce = page.locator('#barraSiti .dash-barra-voce[data-tipo="sito"]');
  await expect(voce).toHaveAttribute('aria-label', '127.0.0.1');
  expect((await salvate(app)).map((v) => v.url)).toEqual([url]);
  const aperte = async () => (await schede(shell)).filter((t) => t.url === url).length;
  await voce.click();
  await expect.poll(aperte, { timeout: 8000 }).toBe(1);
});

test('#1803.1 arrivare nella home per leggere una conversazione riapre la chat ripiegata: chat riaperta, punto del filo, intervista', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'La carbonara vuole guanciale e pecorino.' }]);
  try {
    await page.locator('#input').fill('come si fa la carbonara?');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'guanciale' })).toBeVisible({ timeout: 10_000 });
  } finally { await ripristina(app); }
  const id = await app.evaluate(async () => (await globalThis.SN_IL_FILO.chats()).find((c) => JSON.stringify(c.messages || []).includes('carbonara')).id);
  const evento = await app.evaluate(async (_e, c) => globalThis.SN_IL_FILO.ultimaDomanda(c), id);
  expect(evento).toBeTruthy();
  const ripiegata = () => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).chatRipiegata);
  const ripiega = async () => {
    await imposta(page, { chatRipiegata: true });
    await expect.poll(ripiegata).toBe(true);
  };

  // Una chat riaperta dall'archivio: la conversazione si vede, e la chat resta aperta anche nelle altre home.
  await ripiega();
  const riaperta = await openTab(`filo://newtab/?chat=${encodeURIComponent(id)}`);
  await expect(riaperta.locator('.dash-bubble-filo', { hasText: 'guanciale' })).toBeVisible({ timeout: 15_000 });
  await expect(riaperta.locator('#threadView')).toBeVisible();
  await expect.poll(ripiegata).toBe(false);

  // Un punto del filo (dal quaderno delle memorie): il messaggio si illumina dove lo si vede.
  await ripiega();
  const punto = await openTab(`filo://newtab/?evento=${encodeURIComponent(evento)}`);
  await expect(punto.locator('.dash-trovato')).toContainText('carbonara', { timeout: 15_000 });
  await expect(punto.locator('#threadView')).toBeVisible();
  await expect.poll(ripiegata).toBe(false);

  // L'intervista di benvenuto rifatta dalle Preferenze.
  await ripiega();
  await page.evaluate(() => new Promise((ok) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.FILO_RESTART_ONBOARDING }, ok)));
  const intervista = await openTab('filo://newtab/?accoglienza=1');
  await expect(intervista.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  await expect(intervista.locator('#threadView')).toBeVisible();
  await expect.poll(ripiegata).toBe(false);
});
