// #870 — la home a carte: a sinistra quello che accade, a destra quello che l'utente tiene.
//
// Ogni prova rifà un criterio del feedback coi gesti dell'utente e asserisce che la cosa voluta accade:
// il timer chiesto in chat ha la sua carta che scade e riapre lo scambio, lo scaricamento mostra la
// percentuale e poi «Apri», l'Editor mostra i documenti recenti e ne apre uno, i Mazzi si scambiano con
// l'Editor e si tolgono e si rimettono da «altro» anche dopo il riavvio, i suggerimenti sono una carta
// sola, senza chiave la prima carta porta ai Crediti, e la stessa mossa si chiede a Filo a parole.

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

async function modelloFinto(app, risposte) {
  await app.evaluate(async (_e, risp) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__giro = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const r = risp[Math.min(globalThis.__giro++, risp.length - 1)];
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (r.testo) { try { onDelta && onDelta(r.testo); } catch (_) {} }
      return { ...base, text: r.testo || '', toolCalls: r.strumenti || [], finishReason: r.strumenti ? 'tool_calls' : 'stop' };
    };
  }, risposte);
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
    await page.locator('#altro .dash-altro-cella', { has: icona }).locator('.dash-altro-rimetti').click();
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
    await expect(carta.locator('.dash-carta-filo')).toHaveCSS('opacity', '1');
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

test('foto della home a carte, chiara e scura', async ({ app }) => {
  test.setTimeout(45_000);
  const page = await home(app);
  const m = await MSG(page);
  await manda(page, { type: m.FILO_ADD_TIMER, label: 'Pasta', seconds: 252 });
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const n = await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'alert', text: 'L’aggiornamento è pronto: si installa alla prossima apertura.' });
    void n; void C;
  });
  await manda(page, { type: m.FILO_GET_TIMERS });
  await page.reload();
  await home(app);
  mkdirSync(SHOTS, { recursive: true });
  const scala = process.env.FILO_TEST_SCALE ? `-${process.env.FILO_TEST_SCALE}` : '';
  for (const tema of ['light', 'dark']) {
    await manda(page, { type: m.UPDATE_SETTINGS, settings: { theme: tema } });
    await expect(page.locator('html')).toHaveAttribute('data-sn-theme', tema);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, `home-carte-${tema}${scala}.png`) });
  }
});
