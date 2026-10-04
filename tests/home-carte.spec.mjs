// #870 — la home a carte: a sinistra quello che accade, a destra quello che l'utente tiene.
//
// Ogni prova rifà un criterio del feedback coi gesti dell'utente e asserisce che la cosa voluta accade:
// il timer chiesto in chat ha la sua carta che scade e riapre lo scambio, lo scaricamento mostra la
// percentuale e poi «Apri», l'Editor mostra i documenti recenti e ne apre uno, i Mazzi si scambiano con
// l'Editor e si tolgono e si rimettono da «altro» anche dopo il riavvio, i suggerimenti sono una carta
// sola, senza chiave la prima carta porta ai Crediti, e la stessa mossa si chiede a Filo a parole.
// Le foto (chiara, scura, col menu, in conversazione, stretta) vanno in tests/.shots/; FILO_TEST_SCALE=1.25 per la scala.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'tests', '.shots');

async function home(app) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (w) {
      await w.waitForLoadState('domcontentloaded');
      await expect(w.locator('#tieni .dash-carta').first()).toBeVisible({ timeout: 10_000 });
      return w;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

async function finestraCon(app, prefisso) {
  const scadenza = Date.now() + 10_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x.url().startsWith(prefisso); } catch (_) { return false; } });
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`nessuna finestra su ${prefisso}`);
}

const manda = (page, msg) => page.evaluate((m) => new Promise((ok) => chrome.runtime.sendMessage(m, (r) => ok(r))), msg);
const MSG = (page) => page.evaluate(() => window.SN_MSG.MSG);
const ordineDestra = (page) => page.locator('#tieni > .dash-carta').evaluateAll((ns) => ns.map((n) => n.dataset.chiave));

// `ritardoMs`: quanto ci mette il modello finto a rispondere (un lavoro lungo).
async function modelloFinto(app, risposte, ritardoMs = 0) {
  await app.evaluate(async (_e, { risp, ritardo }) => {
    const C = globalThis.SN_CONST;
    // Col modello pronto partirebbe l'intervista di benvenuto: qui l'utente è già stato accolto.
    await chrome.storage.local.set({ filo_onboarding: { done: true } });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__giro = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const r = risp[Math.min(globalThis.__giro++, risp.length - 1)];
      if (ritardo) await new Promise((ok) => setTimeout(ok, ritardo));
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (r.testo) { try { onDelta && onDelta(r.testo); } catch (_) {} }
      return { ...base, text: r.testo || '', toolCalls: r.strumenti || [], finishReason: r.strumenti ? 'tool_calls' : 'stop' };
    };
  }, { risp: risposte, ritardo: ritardoMs });
}

test('il timer chiesto in chat ha la sua carta a sinistra: conta, scade e il clic riapre lo scambio', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [
    { strumenti: [{ id: 't1', name: 'TIMER', arguments: '{"secondi":4,"etichetta":"Pasta"}' }] },
    { testo: 'Fatto, timer della pasta avviato.' },
  ]);
  await page.locator('#input').fill('metti un timer di 4 secondi per la pasta');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'timer della pasta avviato' })).toBeVisible({ timeout: 10_000 });

  const carta = page.locator('#accade .dash-carta[data-tipo="timer"]', { hasText: 'Pasta' });
  await expect(carta).toBeVisible();
  await expect(carta.locator('.dash-carta-stato')).toHaveText(/^0:0\d$/);

  // Torno alla home: la conversazione si chiude, la carta resta.
  await page.reload();
  await home(app);
  await expect(page.locator('#threadView')).toBeHidden();
  const scaduta = page.locator('#accade .dash-carta[data-tipo="timer"][data-suona="1"]', { hasText: 'Pasta' });
  await expect(scaduta).toBeVisible({ timeout: 10_000 });
  await expect(scaduta.locator('.dash-carta-stato')).toHaveText('scaduto');
  await expect(scaduta.locator('.dash-carta-az.principale')).toHaveText('Ferma');
  await expect(page.locator('#accade')).toHaveAttribute('data-suona', '1');

  // Il clic sulla carta riapre proprio lo scambio che l'ha creato.
  await scaduta.click({ position: { x: 40, y: 50 } });
  await expect(page.locator('#threadView')).toBeVisible();
  await expect(page.locator('.dash-bubble-user', { hasText: 'metti un timer di 4 secondi per la pasta' })).toBeVisible();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'timer della pasta avviato' })).toBeVisible();

  await page.locator('#accade .dash-carta[data-tipo="timer"] .dash-carta-az.principale').click();
  await expect(page.locator('#accade .dash-carta[data-tipo="timer"]')).toHaveCount(0);
  await expect(page.locator('#accade')).toHaveAttribute('data-suona', '0');
});

test('uno scaricamento mostra la percentuale mentre arriva e, finito, «Apri»', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const blocco = Buffer.alloc(64 * 1024, 0x61);
  const quanti = 24;
  const srv = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': blocco.length * quanti,
      'Content-Disposition': 'attachment; filename="preventivo-tetto.bin"',
    });
    let i = 0;
    const via = () => { if (res.destroyed) return; if (i++ >= quanti) { res.end(); return; } res.write(blocco); setTimeout(via, 200); };
    via();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${srv.address().port}/preventivo-tetto.bin`;
    const sito = await testServer.openReady(openTab, `<a id="f" href="${url}">preventivo</a>`);
    await sito.locator('#f').click();
    const page = await home(app);
    const carta = page.locator('#accade .dash-carta[data-tipo="download"]', { hasText: 'preventivo-tetto.bin' });
    await expect(carta.locator('.dash-carta-stato')).toHaveText(/^\d{1,2}% · /, { timeout: 10_000 });
    await expect(carta.locator('.dash-carta-avanza')).toBeVisible();
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'home-carte-download.png') });
    await expect(carta.locator('.dash-carta-stato')).toHaveText(/^scaricato · 1,5 MB$/, { timeout: 20_000 });
    await expect(carta.locator('.dash-carta-az.principale')).toHaveText('Apri');
    await expect(carta.locator('.dash-carta-az.secondaria')).toHaveText('Cartella');
  } finally {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});

test('a destra l’Editor mostra i documenti recenti e un clic ne apre uno', async ({ app }) => {
  test.setTimeout(45_000);
  const page = await home(app);
  await app.evaluate(async () => {
    const giorno = (n) => new Date(Date.now() - n * 864e5).toISOString();
    const file = (id, title, quando) => ({ id, meta: { title, created: quando, modified: quando, version: 1 }, modules: [], content: {} });
    await chrome.storage.local.set({
      'filo.editor.collection': {
        version: 1, activeId: 'f-vecchio',
        files: [file('f-vecchio', 'Lista della spesa', giorno(9)), file('f-nuovo', 'Lettera al condominio', giorno(0)), file('f-ieri', 'Appunti riunione', giorno(1))],
      },
    });
  });
  await page.reload();
  await home(app);
  const editor = page.locator('#tieni .dash-carta[data-tipo="editor"]');
  await expect(editor.locator('.dash-carta-stato')).toHaveText('3 documenti');
  await expect(editor.locator('.dash-carta-voce-testo')).toHaveText(['Lettera al condominio', 'Appunti riunione', 'Lista della spesa']);
  await editor.locator('.dash-carta-voce', { hasText: 'Appunti riunione' }).click();
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  expect(ed.url()).toContain('file=f-ieri');
  await expect.poll(() => ed.evaluate(() => window.__filoEditorVersions && window.__filoEditorVersions.activeId()), { timeout: 8_000 }).toBe('f-ieri');
});

test('trascino i Mazzi sopra l’Editor e si scambiano; tolti finiscono in «altro», da lì si rimettono, e tutto resta dopo il riavvio', async () => {
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-carte-');
  const lancia = () => electron.launch({
    args: [...argomentiScala, '.'],
    cwd: ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  let app = await lancia();
  try {
    let page = await home(app);
    expect(await ordineDestra(page)).toEqual(['editor', 'mazzi', 'suggerimenti', 'rapide']);

    await page.locator('#tieni .dash-carta[data-tipo="mazzi"]').dragTo(page.locator('#tieni .dash-carta[data-tipo="editor"]'), { targetPosition: { x: 60, y: 8 } });
    await expect.poll(() => ordineDestra(page)).toEqual(['mazzi', 'editor', 'suggerimenti', 'rapide']);

    // Tolgo i Mazzi dal tasto destro: diventano un'icona in «altro».
    await page.locator('#tieni .dash-carta[data-tipo="mazzi"]').click({ button: 'right' });
    await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli dalla home' }).click();
    await expect(page.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
    const icona = page.locator('#altro .dash-altro-app[data-id="mazzi"][data-tolta="1"]');
    await expect(icona).toBeVisible();

    // Dal «+» si rimettono, in fondo.
    await icona.hover();
    await page.locator('#altro .dash-altro-cella', { has: page.locator('.dash-altro-app[data-id="mazzi"]') }).locator('.dash-altro-rimetti').click();
    await expect.poll(() => ordineDestra(page)).toEqual(['editor', 'suggerimenti', 'rapide', 'mazzi']);

    // E si ritolgono, e l'Editor va in fondo: dopo il riavvio è tutto com'era.
    await page.locator('#tieni .dash-carta[data-tipo="mazzi"] .dash-carta-togli').click({ force: true });
    await page.locator('#tieni .dash-carta[data-tipo="editor"]').click({ button: 'right' });
    await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Sposta giù' }).click();
    await expect.poll(() => ordineDestra(page)).toEqual(['suggerimenti', 'editor', 'rapide']);
    await chiudiApp(app);

    app = await lancia();
    page = await home(app);
    expect(await ordineDestra(page)).toEqual(['suggerimenti', 'editor', 'rapide']);
    await expect(page.locator('#altro .dash-altro-app[data-id="mazzi"][data-tolta="1"]')).toBeVisible();

    // Trascinata da «altro» nella colonna, torna dove la lascio.
    await page.locator('#altro .dash-altro-app[data-id="mazzi"]').dragTo(page.locator('#tieni .dash-carta[data-tipo="suggerimenti"]'), { targetPosition: { x: 60, y: 6 } });
    await expect.poll(() => ordineDestra(page)).toEqual(['mazzi', 'suggerimenti', 'editor', 'rapide']);
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('«Filo ti suggerisce» è una carta sola e si toglie; senza chiave la prima carta porta ai Crediti', async ({ app }) => {
  const page = await home(app);
  const sug = page.locator('#tieni .dash-carta[data-tipo="suggerimenti"]');
  await expect(sug).toHaveCount(1);
  await expect(page.locator('.dash-carta-tit', { hasText: 'Filo ti suggerisce' })).toHaveCount(1);

  const prima = page.locator('#accade > .dash-carta').first();
  await expect(prima).toHaveAttribute('data-tipo', 'crediti');
  await expect(prima.locator('.dash-carta-az.principale')).toHaveText('Apri Crediti');
  // Il suggerimento dei Crediti è diventato la carta: non resta anche fra i suggerimenti.
  await expect(sug.locator('.dash-carta-voce', { hasText: 'Crediti' })).toHaveCount(0);

  await sug.hover();
  await sug.locator('.dash-carta-togli').click();
  await expect(page.locator('#tieni .dash-carta[data-tipo="suggerimenti"]')).toHaveCount(0);
  await expect(page.locator('#altro .dash-altro-app[data-id="suggerimenti"]')).toBeVisible();

  await prima.locator('.dash-carta-az.principale').click();
  await finestraCon(app, 'filo://credits/credits.html');
});

test('hover e tasto destro su ogni carta; la stessa mossa si chiede a Filo a parole', async ({ app }) => {
  test.setTimeout(45_000);
  const page = await home(app);
  const m = await MSG(page);
  await manda(page, { type: m.FILO_ADD_TIMER, label: 'Forno', seconds: 600 });
  await expect(page.locator('#accade .dash-carta[data-tipo="timer"]')).toBeVisible();

  for (const carta of await page.locator('.dash-carta').all()) {
    await carta.hover();
    await expect(carta.locator('.dash-carta-mani')).toHaveCSS('opacity', '1');
    await carta.click({ button: 'right', position: { x: 30, y: 12 } });
    const menu = page.locator('.dash-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.dash-menu-voce', { hasText: 'Apri nel filo' })).toHaveCount(1);
    await expect(menu.locator('.dash-menu-voce').last()).toHaveText(/^(Togli|Chiudi)/);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  }

  await modelloFinto(app, [
    { strumenti: [{ id: 'c1', name: 'CARTA_HOME', arguments: '{"operazione":"togli","carta":"mazzi"}' }] },
    { testo: 'Tolta: i Mazzi ora sono in «altro».' },
  ]);
  await page.locator('#input').fill('togli la carta dei mazzi');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Tolta' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
  await expect(page.locator('#altro .dash-altro-app[data-id="mazzi"][data-tolta="1"]')).toBeVisible();
});

test('foto della home a carte, chiara e scura, ferma, col menu e in conversazione', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const m = await MSG(page);
  await manda(page, { type: m.FILO_ADD_TIMER, label: 'Pasta', seconds: 252 });
  await app.evaluate(async () => {
    const ora = Date.now();
    const quando = (n) => new Date(ora - n * 36e5).toISOString();
    const file = (id, title, q) => ({ id, meta: { title, created: q, modified: q, version: 1 }, modules: [], content: {} });
    await chrome.storage.local.set({
      'filo.editor.collection': { version: 1, activeId: 'a', files: [file('a', 'Lettera al condominio', quando(1)), file('b', 'Appunti riunione del lunedì', quando(26)), file('c', 'Ricette', quando(200))] },
      decks: [
        { id: 'd1', nome: 'Atraxa superfriends', carte: [], created_at: quando(50), updated_at: quando(3) },
        { id: 'd2', nome: 'Krenko goblin', carte: [], created_at: quando(90), updated_at: quando(80) },
      ],
      savedPages: [
        { id: 's1', url: 'https://www.trenitalia.com/', title: 'Orari dei treni per Bologna', savedAt: quando(2) },
        { id: 's2', url: 'https://it.wikipedia.org/wiki/Orca', title: 'Orca — Wikipedia', savedAt: quando(5) },
      ],
    });
    await globalThis.SN_FILO_MEMORY.addAlarm({ label: 'palestra', time: '07:00', repeat: 'feriali' });
    await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'alert', text: 'L’aggiornamento è pronto: si installa alla prossima apertura.' });
  });
  await page.reload();
  await home(app);
  await expect(page.locator('#tieni .dash-carta[data-tipo="mazzi"] .dash-carta-voce')).toHaveCount(2);
  mkdirSync(SHOTS, { recursive: true });
  const scala = process.env.FILO_TEST_SCALE ? `-${process.env.FILO_TEST_SCALE}` : '';
  for (const tema of ['light', 'dark']) {
    await manda(page, { type: m.UPDATE_SETTINGS, settings: { theme: tema } });
    await expect(page.locator('html')).toHaveAttribute('data-sn-theme', tema);
    await page.mouse.move(640, 300);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, `home-carte-${tema}${scala}.png`) });
    const editor = page.locator('#tieni .dash-carta[data-tipo="editor"]');
    await editor.hover();
    await editor.click({ button: 'right', position: { x: 30, y: 12 } });
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(SHOTS, `home-carte-menu-${tema}${scala}.png`) });
    await page.keyboard.press('Escape');
  }
  await page.locator('#accade .dash-carta[data-tipo="avviso"]').click({ position: { x: 30, y: 12 } });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'aggiornamento è pronto' })).toBeVisible();
  await page.mouse.move(640, 300);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(SHOTS, `home-carte-filo${scala}.png`) });

  // Finestra stretta: colonne da 200 punti, i titoli si accorciano e niente esce dalla carta.
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(900, 640); });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(980);
  await page.waitForTimeout(400);
  const fuori = await page.locator('.dash-carta').evaluateAll((ns) => ns.filter((n) => n.scrollWidth > n.clientWidth + 1).length);
  expect(fuori, 'una carta ha contenuto che esce di lato').toBe(0);
  await page.screenshot({ path: join(SHOTS, `home-carte-stretta${scala}.png`) });
});

test('anche le carte di sinistra si chiedono a Filo: un avviso si chiude, un timer va in cima', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'Il backup delle foto è finito.' });
    await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Pasta', seconds: 60 });
    await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Forno', seconds: 900 });
  });
  // Con la chiave la carta dei Crediti non c'è: nella colonna resta solo quello che succede.
  await modelloFinto(app, [
    { strumenti: [{ id: 'c1', name: 'CARTA_HOME', arguments: '{"operazione":"togli","carta":"l\'avviso del backup"}' }] },
    { strumenti: [{ id: 'c2', name: 'CARTA_HOME', arguments: '{"operazione":"sposta","carta":"il timer del forno","verso":"cima"}' }] },
    { testo: 'Fatto: avviso chiuso e forno in cima.' },
  ]);
  await page.reload();
  await home(app);
  const avviso = page.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'backup delle foto' });
  await expect(avviso).toBeVisible();
  const ordineSinistra = () => page.locator('#accade > .dash-carta').evaluateAll((ns) => ns.map((n) => n.querySelector('.dash-carta-tit').textContent));
  await expect.poll(ordineSinistra).toEqual(['Pasta', 'Forno', 'Filo']);

  await page.locator('#input').fill('chiudi l’avviso del backup e metti il forno in cima');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'avviso chiuso' })).toBeVisible({ timeout: 10_000 });
  await expect(avviso).toHaveCount(0);
  await expect.poll(ordineSinistra).toEqual(['Forno', 'Pasta']);
  // Lo sa anche il registro: chiuso è chiuso, non solo nascosto da questa scheda.
  expect(await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.listNotifications()).length)).toBe(0);
});

test('un lavoro lungo in un’altra scheda compare a sinistra; «Vai» porta lì, e finito sparisce', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const a = await home(app);
  await modelloFinto(app, [{ testo: 'Ecco il confronto fra i tre preventivi.' }], 9_000);
  await a.locator('#input').fill('confronta i tre preventivi che ti ho mandato');
  await a.locator('#sendBtn').click();
  // Nella scheda che lavora la risposta si vede già al centro: lì la carta non serve.
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  let b = null;
  await expect.poll(() => { b = app.windows().find((w) => w !== a && w.url().startsWith('filo://newtab')); return !!b; }).toBe(true);
  await b.waitForLoadState('domcontentloaded');
  const carta = b.locator('#accade .dash-carta[data-tipo="lavoro"]');
  await expect(carta).toBeVisible({ timeout: 8_000 });
  await expect(carta.locator('.dash-carta-tit')).toHaveText('Filo sta lavorando');
  await expect(carta.locator('.dash-carta-stato')).toHaveText('confronta i tre preventivi che ti ho mandato');
  await expect(a.locator('#accade .dash-carta[data-tipo="lavoro"]')).toHaveCount(0);

  await carta.locator('.dash-carta-az.principale').click();
  // «Vai» riporta alla scheda della conversazione, non ne apre una copia qui.
  await expect.poll(() => shell.evaluate(() => [...document.querySelectorAll('.tab')].findIndex((t) => t.classList.contains('active')))).toBe(0);
  await expect(b.locator('#threadView')).toBeHidden();
  await expect(a.locator('.dash-bubble-filo', { hasText: 'confronto fra i tre preventivi' })).toBeVisible({ timeout: 15_000 });
  await expect(b.locator('#accade .dash-carta[data-tipo="lavoro"]')).toHaveCount(0);
});

test('sulle carte di destra il clic fa quello che fa Invio', async ({ app }) => {
  const page = await home(app);
  await page.locator('#tieni .dash-carta[data-tipo="editor"]').click({ position: { x: 150, y: 20 } });
  await finestraCon(app, 'filo://editor/editor.html');
});

test('senza chiave la home non indica pagine salvate che non ci sono', async ({ app }) => {
  const page = await home(app);
  const msg = page.locator('#homeMessage');
  await expect(msg).toContainText('Crediti', { timeout: 10_000 });
  await expect(msg).not.toContainText('pagine salvate');
});

// Il modello finto che si ricorda cosa ha letto: le istruzioni e l'esito di ogni azione.
async function modelloSpia(app, risposte) {
  await modelloFinto(app, risposte);
  await app.evaluate(() => {
    const finto = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__letti = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => { globalThis.__letti.push(o.messages); return finto(o); };
  });
}
const esitiLetti = async (app) => (await app.evaluate(() => globalThis.__letti))
  .map((ms) => ms.filter((m) => m.role === 'tool').map((m) => String(m.content)).join('\n'));

test('chiesta a parole col solo nome, la carta di sinistra si trova: la richiesta in corso non è una carta', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'Il backup delle foto è finito.' });
    await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'Il documento è stato salvato nel cloud.' });
  });
  await modelloSpia(app, [
    { strumenti: [{ id: 'c1', name: 'CARTA_HOME', arguments: '{"operazione":"togli","carta":"backup"}' }] },
    { strumenti: [{ id: 'c2', name: 'CARTA_HOME', arguments: '{"operazione":"togli","carta":"l\'avviso del documento"}' }] },
    { testo: 'Chiusi.' },
  ]);
  await page.reload();
  await home(app);
  await page.locator('#input').fill('togli il backup e l’avviso del documento dalla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Chiusi' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#accade .dash-carta[data-tipo="avviso"]')).toHaveCount(0);
  await expect(page.locator('#tieni .dash-carta[data-tipo="editor"]')).toHaveCount(1);
  // Le istruzioni generali mandano anche le carte di sinistra allo strumento delle carte.
  const istruzioni = String((await app.evaluate(() => globalThis.__letti[0][0].content)) || '');
  expect(istruzioni).toMatch(/CARTE DELLA HOME[^\n]*sinistra[^\n]*avvisi/);
  expect(istruzioni).not.toMatch(/si tolgono togliendo la cosa/);
  // La riga di attività nomina la carta tolta davvero, non l'Editor che ha «documento» fra i suoi nomi.
  await page.getByText('Ha sistemato 2 carte della home').click();
  await expect(page.locator('#bubbles')).toContainText('Carta tolta · Il documento è stato salvato nel cloud.');
  await expect(page.locator('#bubbles')).toContainText('Carta tolta · Il backup delle foto è finito.');
  await expect(page.locator('#bubbles')).not.toContainText('Carta tolta · Editor');
});

test('una carta di sinistra che non si trova: Filo riceve tutte le carte con la chiave, e la destra com’è davvero', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await page.locator('#tieni .dash-carta[data-tipo="mazzi"]').click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli dalla home' }).click();
  await expect(page.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.addNotification({ kind: 'info', text: 'Il backup delle foto è finito: 1.240 foto copiate sul disco esterno.' });
    await M.addNotification({ kind: 'info', text: 'La lavatrice ha finito il programma cotone.' });
    await M.addTimer({ label: 'Pasta', seconds: 600 });
  });
  await modelloSpia(app, [
    { strumenti: [{ id: 'c1', name: 'CARTA_HOME', arguments: '{"operazione":"togli","carta":"l\'avviso del bucato"}' }] },
    { testo: 'Quale?' },
  ]);
  await page.reload();
  await home(app);
  await page.locator('#input').fill('togli l’avviso del bucato');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Quale' })).toBeVisible({ timeout: 10_000 });
  const esito = (await esitiLetti(app))[1];
  const chiavi = await page.locator('#accade > .dash-carta').evaluateAll((ns) => ns.map((n) => n.dataset.chiave));
  expect(chiavi).toHaveLength(3);
  for (const k of chiavi) expect(esito).toContain(k);
  expect(esito).not.toContain('"lavoro');
  expect(esito).toContain('"altro":["Mazzi"]');
  expect(esito).not.toMatch(/destra[^\]]*Mazzi/);
});

// La finestra incognito ha le sue carte: i suoi lavori e le sue mosse non arrivano alla finestra normale.
async function homeIncognito(app, shell, normale) {
  await shell.evaluate(() => window.filoShell.openIncognito());
  const scadenza = Date.now() + 15_000;
  let inc = null;
  while (!inc && Date.now() < scadenza) {
    inc = app.windows().find((w) => { try { return w !== normale && w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (!inc) await new Promise((r) => setTimeout(r, 100));
  }
  await inc.waitForLoadState('domcontentloaded');
  await expect(inc.locator('#tieni .dash-carta').first()).toBeVisible({ timeout: 10_000 });
  const inIncognito = await app.evaluate(({ webContents, session }) => webContents.getAllWebContents()
    .filter((wc) => wc.getURL().startsWith('filo://newtab') && wc.session !== session.defaultSession).length);
  expect(inIncognito).toBe(1);
  return inc;
}

test('la domanda fatta in incognito non compare fra le carte della finestra normale', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const normale = await home(app);
  await modelloFinto(app, [{ testo: 'Ecco.' }], 12_000);
  const inc = await homeIncognito(app, shell, normale);
  await inc.locator('#input').fill('sintomi della malattia di cui non voglio si sappia');
  await inc.locator('#sendBtn').click();
  await normale.waitForTimeout(5_000);
  await expect(normale.locator('#accade')).not.toContainText('sintomi della malattia');
  await expect(normale.locator('#accade .dash-carta[data-tipo="lavoro"]')).toHaveCount(0);
  const lavoriNormale = await normale.evaluate(() => new Promise((ok) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.LAVORI_IN_CORSO }, ok)));
  expect(lavoriNormale.lavori).toEqual([]);
});

test('una carta tolta in incognito non cambia la home della finestra normale', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const normale = await home(app);
  const inc = await homeIncognito(app, shell, normale);
  await inc.locator('#tieni .dash-carta[data-tipo="mazzi"]').click({ button: 'right' });
  await inc.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli dalla home' }).click();
  await expect(inc.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
  await normale.waitForTimeout(1_000);
  await expect(normale.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(1);
});

test('tasto destro su un documento della carta: il menu è di quel documento', async ({ app }) => {
  test.setTimeout(45_000);
  const page = await home(app);
  await app.evaluate(async () => {
    const q = new Date().toISOString();
    const file = (id, title) => ({ id, meta: { title, created: q, modified: q, version: 1 }, modules: [], content: {} });
    await chrome.storage.local.set({ 'filo.editor.collection': { version: 1, activeId: 'a', files: [file('a', 'Lettera al condominio'), file('b', 'Ricette')] } });
  });
  await page.reload();
  await home(app);
  const voce = page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-voce', { hasText: 'Ricette' });
  await voce.click({ button: 'right' });
  const menu = page.locator('.dash-menu');
  await expect(menu.locator('.dash-menu-voce')).toHaveText(['Apri «Ricette»', 'Apri nel filo']);
  await menu.locator('.dash-menu-voce', { hasText: 'Apri nel filo' }).click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Il documento «Ricette» è nell’Editor' })).toBeVisible();
  await voce.focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu.locator('.dash-menu-voce').first()).toHaveText('Apri «Ricette»');
  await page.keyboard.press('Enter');
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  expect(ed.url()).toContain('file=b');
});

test('la stessa carta aperta due volte nel filo non ripete la frase', async ({ app }) => {
  test.setTimeout(45_000);
  const page = await home(app);
  await app.evaluate(async () => { await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'Il backup delle foto è finito.' }); });
  await page.reload();
  await home(app);
  const avviso = page.locator('#accade .dash-carta[data-tipo="avviso"]');
  await avviso.click({ position: { x: 30, y: 12 } });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'backup delle foto' })).toHaveCount(1);
  await avviso.click({ position: { x: 30, y: 12 } });
  await page.waitForTimeout(400);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'backup delle foto' })).toHaveCount(1);
});

test('«Nuovo mazzo» sulla carta vuota apre un mazzo nuovo', async ({ app }) => {
  const page = await home(app);
  const bott = page.locator('#tieni .dash-carta[data-tipo="mazzi"] .dash-carta-az.principale');
  await expect(bott).toHaveText('Nuovo mazzo');
  await bott.dblclick();
  const mazzi = await finestraCon(app, 'filo://decks/');
  await expect.poll(() => mazzi.url(), { timeout: 8_000 }).toContain('#/deck/');
  await expect(page.locator('#tieni .dash-carta[data-tipo="mazzi"] .dash-carta-stato')).toHaveText('1 mazzo');
});

test('la carta dei Crediti tolta va in «altro» e si rimette da sola: la destra resta come l’ha disposta l’utente', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await page.locator('#tieni .dash-carta[data-tipo="mazzi"]').click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli dalla home' }).click();
  await expect(page.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
  const disposta = await ordineDestra(page);

  const crediti = page.locator('#accade .dash-carta[data-tipo="crediti"]');
  await crediti.click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: /^Togli/ }).click();
  await expect(crediti).toHaveCount(0);

  const inAltro = page.locator('#altro .dash-altro-app[data-tolta="1"]', { hasText: 'Crediti' });
  await expect(inAltro).toHaveCount(1);
  await inAltro.click({ button: 'right' });
  await expect(page.locator('.dash-menu .dash-menu-voce')).toHaveText(['Apri Crediti', 'Rimetti nella home']);
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Rimetti' }).click();
  await expect(crediti).toBeVisible();
  await expect(inAltro).toHaveCount(0);
  expect(await ordineDestra(page)).toEqual(disposta);
  await page.reload();
  await home(app);
  await expect(crediti).toBeVisible();
});

test('uno scaricamento tolto dalla home torna chiesto a parole, e la disposizione resta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="bolletta-luce.bin"' });
    res.end(Buffer.alloc(2048, 0x61));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const sito = await testServer.openReady(openTab, `<a id="f" href="http://127.0.0.1:${srv.address().port}/bolletta-luce.bin">bolletta</a>`);
    await sito.locator('#f').click();
    const page = await home(app);
    const carta = page.locator('#accade .dash-carta[data-tipo="download"]', { hasText: 'bolletta-luce.bin' });
    await expect(carta.locator('.dash-carta-stato')).toHaveText(/^scaricato/, { timeout: 15_000 });
    await page.locator('#tieni .dash-carta[data-tipo="mazzi"]').click({ button: 'right' });
    await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli dalla home' }).click();
    await carta.hover();
    await carta.locator('.dash-carta-togli').click();
    await expect(carta).toHaveCount(0);
    await expect(page.locator('#altro .dash-altro-app[data-tolta="1"]', { hasText: 'bolletta-luce.bin' })).toBeVisible();

    await modelloFinto(app, [
      { strumenti: [{ id: 'c1', name: 'CARTA_HOME', arguments: '{"operazione":"rimetti","carta":"lo scaricamento della bolletta"}' }] },
      { testo: 'Rimesso nella home.' },
    ]);
    await page.locator('#input').fill('rimetti nella home lo scaricamento della bolletta');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Rimesso' })).toBeVisible({ timeout: 10_000 });
    await expect(carta).toBeVisible();
    await expect(page.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
  } finally {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});

test('una finestra incognito mostra le carte di destra come le ha disposte l’utente', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const normale = await home(app);
  await normale.locator('#tieni .dash-carta[data-tipo="mazzi"]').click({ button: 'right' });
  await normale.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli dalla home' }).click();
  await expect(normale.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
  const disposta = await ordineDestra(normale);

  const inc = await homeIncognito(app, shell, normale);
  await expect.poll(() => ordineDestra(inc)).toEqual(disposta);
  await expect(inc.locator('#altro .dash-altro-app[data-id="mazzi"][data-tolta="1"]')).toBeVisible();
  // E quello che si muove lì resta lì.
  await inc.locator('#altro .dash-altro-app[data-id="mazzi"] + .dash-altro-rimetti').click();
  await expect(inc.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(1);
  await normale.reload();
  await expect(normale.locator('#tieni .dash-carta').first()).toBeVisible({ timeout: 10_000 });
  await expect(normale.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
});

// Trascina col mouse vero `da` fino a `frazione` dell'altezza di `su`, e la lascia lì.
async function trascinaSu(page, da, su, frazione) {
  const a = await da.boundingBox();
  const b = await su.boundingBox();
  await page.mouse.move(a.x + 60, a.y + 20);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + 10, { steps: 3 });
  await page.mouse.move(b.x + 60, b.y + b.height * frazione, { steps: 10 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}
const ordineSx = (page) => page.locator('#accade > .dash-carta').evaluateAll((ns) => ns.map((n) => n.dataset.tipo));

test('una carta lasciata sopra un’altra ne prende il posto, in qualunque metà la si lasci', async ({ app }) => {
  test.setTimeout(45_000);
  const page = await home(app);
  const carta = (t) => page.locator(`#tieni .dash-carta[data-tipo="${t}"]`);
  await trascinaSu(page, carta('mazzi'), carta('editor'), 0.75);
  await expect.poll(() => ordineDestra(page)).toEqual(['mazzi', 'editor', 'suggerimenti', 'rapide']);
  await trascinaSu(page, carta('mazzi'), carta('editor'), 0.25);
  await expect.poll(() => ordineDestra(page)).toEqual(['editor', 'mazzi', 'suggerimenti', 'rapide']);

  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Pasta', seconds: 900 });
    await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'La lavatrice ha finito.' });
  });
  await page.reload();
  await home(app);
  await expect.poll(() => ordineSx(page)).toEqual(['crediti', 'timer', 'avviso']);
  await trascinaSu(page, page.locator('#accade .dash-carta[data-tipo="avviso"]'), page.locator('#accade .dash-carta[data-tipo="timer"]'), 0.75);
  await expect.poll(() => ordineSx(page)).toEqual(['crediti', 'avviso', 'timer']);
});

test('le carte fisse in cima a sinistra non si scavalcano: il menu non lo offre e la chat lo dice', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Pasta', seconds: 900 });
    await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Forno', seconds: 1 });
  });
  await page.reload();
  await home(app);
  await expect(page.locator('#accade .dash-carta[data-suona="1"]')).toHaveCount(1, { timeout: 10_000 });
  await expect.poll(() => ordineSx(page)).toEqual(['crediti', 'timer', 'timer']);
  const pasta = page.locator('#accade .dash-carta', { hasText: 'Pasta' });
  await pasta.click({ button: 'right', position: { x: 30, y: 12 } });
  await expect(page.locator('.dash-menu .dash-menu-voce', { hasText: 'Apri nel filo' })).toBeVisible();
  await expect(page.locator('.dash-menu .dash-menu-voce', { hasText: /^Sposta/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const crediti = page.locator('#accade .dash-carta[data-tipo="crediti"]');
  await crediti.click({ button: 'right', position: { x: 30, y: 12 } });
  await expect(page.locator('.dash-menu .dash-menu-voce', { hasText: /^Sposta/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await modelloSpia(app, [
    { strumenti: [{ id: 'c1', name: 'CARTA_HOME', arguments: '{"operazione":"sposta","carta":"il timer della pasta","prima_di":"il timer del forno"}' }] },
    { testo: 'Il forno sta suonando: resta in cima.' },
  ]);
  await page.locator('#input').fill('metti la pasta sopra il forno');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'resta in cima' })).toBeVisible({ timeout: 10_000 });
  expect((await esitiLetti(app))[1]).toContain('sta in cima finché suona');
});
