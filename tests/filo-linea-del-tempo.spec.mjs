// #866 — il filo: chat della home e pagine visitate in una linea del tempo sua, su disco appena esistono, senza
// tetti, cancellabili davvero, esportabili, e mai su disco dall'incognito. Ogni prova guarda il FILE, non solo l'app.
// Senza il filo ogni prova è rossa: le chat stavano in storage.json e le pagine visitate non si registravano.

import { test, expect, chiudiApp, argomentiScala } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { clickConfirm, confirmText } from './helpers/confirm.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { buildExportZip } = createRequire(import.meta.url)('../src/main/services/exportData.js');
const fileFilo = (userData) => join(userData, 'filo', 'eventi.jsonl');
const leggiFilo = (userData) => (existsSync(fileFilo(userData)) ? readFileSync(fileFilo(userData), 'utf8') : '');
const eventi = (userData) => leggiFilo(userData).split('\n').filter(Boolean).map((r) => JSON.parse(r));

async function avvia(userData) {
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
  return { app, shell };
}

async function paginaInterna(app, shell, url) {
  const host = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.windows().some((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } }),
    { timeout: 10_000 }).toBe(true);
  const page = app.windows().find((w) => new URL(w.url()).hostname === host);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function configura(app, { rispostaCheNonArriva = false } = {}) {
  await app.evaluate(async (_e, { rispostaCheNonArriva }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const rispondi = async ({ attempts, messages }) => {
      const joined = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (joined.includes('Classifichi le conversazioni')) return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Chat di prova' }) };
      if (rispostaCheNonArriva && joined.includes('RESTA-APPESA')) await new Promise(() => {});
      return { ...base, text: JSON.stringify({ text: 'Risposta di Filo.', actions: [] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  }, { rispostaCheNonArriva });
}

const turno = (app, chatId, userMessage) => app.evaluate(
  (_e, a) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: a.userMessage, threadHistory: [], chatId: a.chatId }),
  { chatId, userMessage },
);

const LUNGO = ('La coscienza nasce dal cervello o lo attraversa? ').repeat(500).slice(0, 20_000);
const IERI = new Date(Date.now() - 26 * 3600e3).toISOString();
const CHAT_VECCHIE = [
  {
    id: 'chat-coscienza', startedAt: IERI, updatedAt: IERI, closedAt: IERI,
    title: 'La coscienza è emergente?', kind: 'conversazione', onboarding: false, triagedCount: 3,
    messages: [
      { role: 'user', text: 'Secondo te la coscienza è emergente?', ts: IERI },
      { role: 'filo', text: 'È una delle domande più aperte: provo a dirti le due strade.', ts: IERI },
      { role: 'user', text: LUNGO, ts: IERI },
    ],
  },
  {
    id: 'chat-sveglia', startedAt: IERI, updatedAt: IERI, closedAt: IERI,
    title: 'Sveglia alle sette', kind: 'comando', onboarding: false, triagedCount: 2,
    messages: [{ role: 'user', text: 'Metti una sveglia alle 7', ts: IERI }, { role: 'filo', text: 'Fatto.', ts: IERI }],
  },
];

test('dopo l’aggiornamento le chat di prima si riaprono dalla Cronologia e Filo le ritrova, coi messaggi interi', async () => {
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-866-mig-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ filo_chats: CHAT_VECCHIE }), 'utf8');
  const { app, shell } = await avvia(userData);
  try {
    const page = await paginaInterna(app, shell, 'filo://archive/archive.html');
    const elenco = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'filo_chats_list' }));
    expect(elenco.chats.map((c) => [c.id, c.messageCount])).toEqual([['chat-coscienza', 3], ['chat-sveglia', 2]]);
    await expect(page.locator('.arc-chat', { hasText: 'La coscienza è emergente?' })).toBeVisible({ timeout: 10_000 });

    const riaperta = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'filo_chat_get', id: 'chat-coscienza' }));
    expect(riaperta.chat.messages[2].text).toBe(LUNGO);

    const trovata = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CERCA_CHAT', query: 'riprendi la discussione di ieri sulla coscienza' }));
    expect(trovata.output.results.map((r) => r.id)).toContain('chat-coscienza');
    const letta = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CERCA_CHAT', id: 'chat-coscienza' }));
    expect(letta.output.found).toBe(true);
    expect(letta.output.transcript).toContain('Secondo te la coscienza è emergente?');

    await app.evaluate(() => globalThis.__filoStorage.whenSettled());
    const storage = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
    expect(storage.filo_chats, 'le chat sono rimaste anche in storage.json').toBeUndefined();
    const msg = eventi(userData).filter((e) => e.tipo === 'messaggio');
    expect(msg.length).toBe(5);
    expect(msg.find((e) => e.msg.text === LUNGO)).toBeTruthy();
  } finally {
    await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});

test('un messaggio è su disco appena esiste, e chiudere l’app di colpo a metà turno non lo perde', async () => {
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-866-crash-');
  let { app } = await avvia(userData);
  try {
    await configura(app, { rispostaCheNonArriva: true });
    await turno(app, 'chat-crash', 'Prima domanda, con risposta');
    expect(eventi(userData).filter((e) => e.chat === 'chat-crash').map((e) => e.msg.text))
      .toEqual(['Prima domanda, con risposta', 'Risposta di Filo.']);

    app.evaluate(() => { globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'Seconda domanda RESTA-APPESA', threadHistory: [], chatId: 'chat-crash' }); }).catch(() => {});
    await expect.poll(() => leggiFilo(userData).includes('Seconda domanda RESTA-APPESA'), { timeout: 10_000 }).toBe(true);
    process.kill(app.process().pid, 'SIGKILL');
    await chiudiApp(app);

    ({ app } = await avvia(userData));
    const chat = await app.evaluate(() => globalThis.SN_FILO_CHATS.get('chat-crash'));
    expect(chat.messages.map((m) => m.text)).toEqual(['Prima domanda, con risposta', 'Risposta di Filo.', 'Seconda domanda RESTA-APPESA']);
  } finally {
    await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});

test('tre pagine aperte lasciano tre eventi col titolo; dall’incognito niente arriva sul file', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  const pagina = (titolo) => testServer.html(`<!doctype html><title>${titolo}</title><p>${titolo}</p>`);
  const urls = [pagina('Prima pagina'), pagina('Seconda pagina'), pagina('Terza pagina')];
  for (const u of urls) await openTab(u);
  const visite = () => eventi(userData).filter((e) => e.tipo === 'navigazione' && urls.includes(e.url));
  await expect.poll(() => visite().length, { timeout: 20_000 }).toBe(3);
  expect(visite().map((e) => e.titolo).sort()).toEqual(['Prima pagina', 'Seconda pagina', 'Terza pagina']);
  for (const e of visite()) {
    expect(e.autore).toBe('utente');
    expect(e.dispositivo).toBeTruthy();
    expect(e.scheda).not.toBeNull();
  }

  const prima = leggiFilo(userData);
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito && w._filoTabs)),
    { timeout: 10_000 }).toBe(true);
  const segreta = pagina('Pagina in incognito');
  await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab(u), segreta);
  // La pagina è passata dal registro (nel filo in memoria dell'incognito), e il file non l'ha vista.
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine(null, { incognito: true })).map((p) => p.titolo)),
    { timeout: 20_000 }).toContain('Pagina in incognito');
  await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
  expect(leggiFilo(userData)).toBe(prima);
  expect(leggiFilo(userData)).not.toContain('Pagina in incognito');
});

test('con 50.000 eventi nel filo un messaggio di 20.000 caratteri si salva intero e senza rallentare', async () => {
  test.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-866-50k-');
  mkdirSync(join(userData, 'filo'), { recursive: true });
  const righe = [];
  const t0 = Date.now() - 40 * 24 * 3600e3;
  for (let i = 0; i < 50_000; i++) {
    const base = { v: 1, id: `seme-${i}`, ts: new Date(t0 + i * 60e3).toISOString(), dispositivo: 'telefono' };
    righe.push(JSON.stringify(i % 2
      ? { ...base, autore: 'utente', tipo: 'navigazione', url: `https://esempio.test/${i}`, titolo: `Pagina ${i}` }
      : { ...base, autore: i % 4 ? 'filo' : 'utente', tipo: 'messaggio', chat: `vecchia-${Math.floor(i / 40)}`, msg: { role: i % 4 ? 'filo' : 'user', text: `messaggio ${i}` } }));
  }
  writeFileSync(fileFilo(userData), righe.join('\n') + '\n', 'utf8');
  const { app } = await avvia(userData);
  try {
    await configura(app);
    const misure = await app.evaluate(async (_e, lungo) => {
      const F = globalThis.SN_FILO_CHATS;
      await F.list();
      const tempi = [];
      for (let i = 0; i < 7; i++) {
        const t = performance.now();
        await F.append('misura', { role: 'user', text: `domanda ${i}` });
        tempi.push(performance.now() - t);
      }
      await globalThis.SN_HANDLE_FILO_CHAT({ userMessage: lungo, threadHistory: [], chatId: 'chat-lunga' });
      return { mediana: tempi.sort((a, b) => a - b)[3], chats: (await F.list()).length, pagine: (await globalThis.SN_IL_FILO.pagine()).length };
    }, LUNGO);
    expect(misure.pagine).toBe(25_000);
    expect(misure.chats).toBe(1252);
    expect(misure.mediana, `un messaggio con 50.000 eventi ci mette ${misure.mediana.toFixed(1)} ms`).toBeLessThan(150);
    const chat = await app.evaluate(() => globalThis.SN_FILO_CHATS.get('chat-lunga'));
    expect(chat.messages[0].text).toBe(LUNGO);
    expect(eventi(userData).find((e) => e.chat === 'chat-lunga' && e.msg.role === 'user').msg.text.length).toBe(20_000);
  } finally {
    await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});

test('cancellare una chat dalla Cronologia la toglie dal file; «cancella le pagine dell’ultima ora» toglie quelle e nessun’altra', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  await configura(app);
  await turno(app, 'chat-da-tenere', 'Parliamo di Epicuro');
  await turno(app, 'chat-da-cancellare', 'Parliamo del Barocco ZXQ');
  await app.evaluate(async () => { await globalThis.SN_CLOSE_FILO_CHAT('chat-da-tenere'); await globalThis.SN_CLOSE_FILO_CHAT('chat-da-cancellare'); });
  await app.evaluate(() => globalThis.SN_IL_FILO.registraVisita({
    url: 'https://vecchia.test/', titolo: 'Pagina di tre ore fa', ts: new Date(Date.now() - 3 * 3600e3).toISOString(),
  }));
  const recente = testServer.html('<!doctype html><title>Pagina di adesso</title>');
  await openTab(recente);
  await expect.poll(() => leggiFilo(userData).includes('Pagina di adesso'), { timeout: 20_000 }).toBe(true);

  const page = await openTab('filo://archive/archive.html');
  const riga = page.locator('.arc-chat', { hasText: 'Barocco ZXQ' });
  await expect(riga).toBeVisible({ timeout: 10_000 });
  await riga.click({ button: 'right' });
  await page.locator('.arc-ctxmenu .sn-select-option', { hasText: 'Elimina la chat' }).click();
  await expect.poll(() => page.evaluate(() => window.SN_CONFIRM_UI._test.state()?.title || null)).toBe('Elimina la chat');
  await page.evaluate(() => window.SN_CONFIRM_UI._test.click('danger') || window.SN_CONFIRM_UI._test.click('ok'));
  await expect.poll(() => leggiFilo(userData).includes('Barocco ZXQ'), { timeout: 10_000 }).toBe(false);
  expect(leggiFilo(userData)).toContain('Parliamo di Epicuro');

  const chiesta = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CANCELLA_PAGINE', periodo: 'ultima_ora' }));
  expect(chiesta.needsConfirm).toBe(2);
  expect(chiesta.describe).toContain('la pagina visitata dell’ultima ora');
  const fatta = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CANCELLA_PAGINE', periodo: 'ultima_ora' }, { confirmed: true }));
  expect(fatta.output.cancellate).toBe(1);
  const testo = leggiFilo(userData);
  expect(testo).not.toContain('Pagina di adesso');
  expect(testo).toContain('Pagina di tre ore fa');
  expect(testo).toContain('Parliamo di Epicuro');
});

test('dalla pagina Sicurezza «Cancella oggi» dice quante pagine sono e le toglie dal file', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  await app.evaluate(() => globalThis.SN_IL_FILO.registraVisita({
    url: 'https://ieri.test/', titolo: 'Pagina di ieri', ts: new Date(Date.now() - 30 * 3600e3).toISOString(),
  }));
  await openTab(testServer.html('<!doctype html><title>Oggi uno</title>'));
  await openTab(testServer.html('<!doctype html><title>Oggi due</title>'));
  await expect.poll(() => ['Oggi uno', 'Oggi due'].every((t) => leggiFilo(userData).includes(t)), { timeout: 20_000 }).toBe(true);

  const page = await openTab('filo://security/security.html');
  await expect(page.locator('#sec-visite-oggi')).toHaveText('Cancella oggi');
  await page.screenshot({ path: 'tests/.shots/filo-866-sicurezza.png', fullPage: true }).catch(() => {});
  await page.locator('#sec-visite-oggi').click();
  await expect.poll(() => confirmText(page), { timeout: 10_000 }).toContain('le 2 pagine visitate oggi');
  await clickConfirm(page, 'ok');
  await expect(page.locator('#sec-visite-hint')).toHaveText('2 pagine cancellate');
  const testo = leggiFilo(userData);
  expect(testo).not.toContain('Oggi uno');
  expect(testo).not.toContain('Oggi due');
  expect(testo).toContain('Pagina di ieri');

  await page.locator('#sec-visite-ora').click();
  await expect(page.locator('#sec-visite-hint')).toHaveText('Nessuna pagina da cancellare');
});

test('Esporta e Importa dati su un profilo vuoto riportano il filo intero', async () => {
  test.setTimeout(120_000);
  const sorgente = cartellaTemporanea('filo-866-esp-');
  const destinazione = cartellaTemporanea('filo-866-imp-');
  const zip = join(sorgente, 'backup.zip');
  let { app, shell } = await avvia(sorgente);
  let prima;
  try {
    await configura(app);
    await turno(app, 'chat-esportata', 'Una chat da portare altrove');
    await app.evaluate(() => globalThis.SN_IL_FILO.registraVisita({ url: 'https://esportata.test/', titolo: 'Pagina esportata' }));
    prima = await app.evaluate(async () => ({ chats: await globalThis.SN_FILO_CHATS.list(), pagine: await globalThis.SN_IL_FILO.pagine() }));
    await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, zip);
    const page = await paginaInterna(app, shell, 'filo://security/security.html');
    await page.locator('#sec-export-btn').click();
    await expect.poll(() => existsSync(zip), { timeout: 15_000 }).toBe(true);
  } finally {
    await chiudiApp(app);
  }

  ({ app, shell } = await avvia(destinazione));
  try {
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, zip);
    const page = await paginaInterna(app, shell, 'filo://security/security.html');
    await page.locator('#sec-import-btn').click();
    await expect.poll(() => confirmText(page), { timeout: 15_000 }).toContain('1 chat con Filo e 1 pagina visitata');
    await clickConfirm(page, 'ok');
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_FILO_CHATS.list()).length), { timeout: 15_000 }).toBe(1);
    const dopo = await app.evaluate(async () => ({ chats: await globalThis.SN_FILO_CHATS.list(), pagine: await globalThis.SN_IL_FILO.pagine() }));
    expect(dopo.chats).toEqual(prima.chats);
    expect(dopo.pagine).toEqual(prima.pagine);
    expect(leggiFilo(destinazione)).toContain('Una chat da portare altrove');
  } finally {
    await chiudiApp(app);
    rmSync(sorgente, { recursive: true, force: true });
    rmSync(destinazione, { recursive: true, force: true });
  }
});

test('un export di prima del filo, con le chat in data.json, si importa e le chat entrano nel filo', async () => {
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-866-vecchio-');
  const zip = join(userData, 'vecchio.zip');
  writeFileSync(zip, buildExportZip({ filo_chats: CHAT_VECCHIE, filo_memory: { PROFILO: 'Ada' } }));
  const { app, shell } = await avvia(userData);
  try {
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, zip);
    const page = await paginaInterna(app, shell, 'filo://security/security.html');
    await page.locator('#sec-import-btn').click();
    await expect.poll(() => confirmText(page), { timeout: 15_000 }).toContain('1 sezione di dati e nessuna immagine, più 2 chat con Filo');
    await clickConfirm(page, 'ok');
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_FILO_CHATS.list()).map((c) => c.messages.length)), { timeout: 15_000 })
      .toEqual([3, 2]);
    await app.evaluate(() => globalThis.__filoStorage.whenSettled());
    expect(JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8')).filo_chats).toBeUndefined();
    expect(leggiFilo(userData)).toContain('Secondo te la coscienza è emergente?');
  } finally {
    await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});

test('un sito non conta né cancella le pagine visitate, nemmeno chiedendolo come azione', async ({ app, openTab, testServer }) => {
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  const sito = await testServer.openReady(openTab, '<!doctype html><title>Sito curioso</title><h1>ciao</h1>');
  await expect.poll(() => leggiFilo(userData).includes('Sito curioso'), { timeout: 20_000 }).toBe(true);
  const host = new URL(sito.url()).host + '/';
  const chiedi = (m) => app.evaluate(async ({ webContents }, { host, m }) => {
    const wc = webContents.getAllWebContents().filter((w) => !w.isDestroyed() && String(w.getURL()).includes(host)).pop();
    return wc.executeJavaScriptInIsolatedWorld(999, [{ code: `chrome.runtime.sendMessage(${JSON.stringify(m)})` }]);
  }, { host, m });
  expect((await chiedi({ type: 'filo_pagine_conta', periodo: 'tutto' }))?.error).toBe('forbidden');
  expect((await chiedi({ type: 'filo_pagine_cancella', periodo: 'tutto' }))?.error).toBe('forbidden');
  const azione = await chiedi({ type: 'filo_run_action', action: { type: 'CANCELLA_PAGINE', periodo: 'tutto' } });
  expect(azione?.executed).not.toBe(true);
  const conferma = await chiedi({ type: 'filo_confirm_action', action: { type: 'CANCELLA_PAGINE', periodo: 'tutto' } });
  expect(conferma?.executed).not.toBe(true);
  expect(leggiFilo(userData)).toContain('Sito curioso');
});

test('riaprire Filo con le schede di prima non scrive una visita nuova per ognuna', async () => {
  test.setTimeout(120_000);
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>Pagina ${req.url}</title><p>x</p>`); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const urls = [`${base}/uno`, `${base}/due`];
  const userData = cartellaTemporanea('filo-866-ripristino-');
  let { app, shell } = await avvia(userData);
  const visite = () => eventi(userData).filter((e) => e.tipo === 'navigazione' && urls.includes(e.url)).length;
  try {
    for (const u of urls) await shell.evaluate((x) => window.filoShell.tabs.open(x), u);
    await expect.poll(visite, { timeout: 20_000 }).toBe(2);
    await new Promise((r) => setTimeout(r, 2500));
    await chiudiApp(app, { tetto: 15_000 });
    ({ app, shell } = await avvia(userData));
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .flatMap((w) => (w._filoTabs?.tabs || []).map((t) => t.view.webContents.getURL()))), { timeout: 20_000 })
      .toEqual(expect.arrayContaining(urls));
    // Dalla scheda ripristinata l'utente va altrove: questa sì che è una visita.
    await app.evaluate(({ BrowserWindow }, u) => {
      const t = BrowserWindow.getAllWindows().flatMap((w) => w._filoTabs?.tabs || []).find((x) => x.view.webContents.getURL() === u);
      t.view.webContents.loadURL(u.replace('/uno', '/tre'));
    }, urls[0]);
    await expect.poll(() => eventi(userData).some((e) => e.tipo === 'navigazione' && e.url === `${base}/tre`), { timeout: 20_000 }).toBe(true);
    await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
    expect(visite(), 'il riavvio ha scritto una visita per ogni scheda ripristinata').toBe(2);
  } finally {
    await chiudiApp(app);
    server.close();
    rmSync(userData, { recursive: true, force: true });
  }
});

test('la chat della home in una finestra incognito resta fuori dal file, anche a scheda chiusa', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  await configura(app);
  await shell.evaluate(() => window.filoShell.openIncognito());
  // La home dell'incognito si riconosce dal main: le si mette un segno e la si cerca fra le pagine.
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
    const t = w && w._filoTabs.tabs.find((tt) => tt.view.webContents.getURL().startsWith('filo://newtab'));
    if (!t) return false;
    try { await t.view.webContents.executeJavaScript('window.__homeIncognito = 1'); return true; } catch (_) { return false; }
  }), { timeout: 20_000 }).toBe(true);
  let home = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try { if (await w.evaluate(() => window.__homeIncognito === 1)) { home = w; return true; } } catch (_) {}
    }
    return false;
  }, { timeout: 20_000 }).toBe(true);
  await home.locator('#input').fill('Messaggio SEGRETO-INCOG-42');
  await home.locator('#sendBtn').click();
  const inMemoria = (t) => app.evaluate(async (_e, t) => (await globalThis.SN_IL_FILO.chats({ incognito: true }))
    .some((c) => c.messages.some((m) => m.text.includes(t))), t);
  await expect.poll(() => inMemoria('SEGRETO-INCOG-42'), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => inMemoria('Risposta di Filo'), { timeout: 20_000 }).toBe(true);
  await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
  expect(leggiFilo(userData)).not.toContain('SEGRETO-INCOG-42');

  await turno(app, 'chat-normale-77', 'Messaggio NORMALE-77');
  await expect.poll(() => leggiFilo(userData).includes('NORMALE-77'), { timeout: 10_000 }).toBe(true);

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoIncognito).close());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito)), { timeout: 10_000 }).toBe(false);
  await new Promise((r) => setTimeout(r, 1500));
  await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
  expect(leggiFilo(userData)).not.toContain('SEGRETO-INCOG-42');
  expect(await app.evaluate(async () => (await globalThis.SN_IL_FILO.chats({ incognito: true })).length)).toBe(0);
});

test('«cancella le pagine di YouTube» chiede l’OK col conto di quel sito e toglie solo quelle dal file', async ({ app }) => {
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  await app.evaluate(async () => {
    for (const [url, titolo] of [['https://www.youtube.com/watch?v=1', 'Video uno'], ['https://m.youtube.com/watch?v=2', 'Video due'], ['https://it.wikipedia.org/', 'Wikipedia']]) {
      await globalThis.SN_IL_FILO.registraVisita({ url, titolo });
    }
  });
  const chiesta = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CANCELLA_PAGINE', sito: 'youtube.com' }));
  expect(chiesta.needsConfirm).toBe(2);
  expect(chiesta.describe).toContain('le 2 pagine visitate su youtube.com di sempre');
  const fatta = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CANCELLA_PAGINE', sito: 'youtube.com' }, { confirmed: true }));
  expect(fatta.output.cancellate).toBe(2);
  const testo = leggiFilo(userData);
  expect(testo).not.toContain('Video uno');
  expect(testo).not.toContain('Video due');
  expect(testo).toContain('Wikipedia');
});

test('una pagina che riscrive il proprio indirizzo (una mappa spostata) resta una pagina visitata', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  const page = await openTab(testServer.html('<!doctype html><title>Mappa</title><p>mappa</p>'));
  const visite = () => eventi(userData).filter((e) => e.tipo === 'navigazione');
  await expect.poll(() => visite().length, { timeout: 20_000 }).toBe(1);
  for (let i = 0; i < 20; i++) {
    await page.evaluate((k) => history.replaceState(null, '', location.pathname + '?@41.9,12.' + k + ',15z'), i);
    await page.waitForTimeout(80);
  }
  // Una pagina nuova dentro la stessa (pushState, come un video dopo l'altro) resta invece una visita in più.
  await page.evaluate(() => { history.pushState(null, '', '/altro-video'); document.title = 'Altro video'; });
  await expect.poll(() => visite().length, { timeout: 10_000 }).toBe(2);
  await page.waitForTimeout(1000);
  await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
  expect(visite().map((e) => e.titolo)).toEqual(['Mappa', 'Altro video']);
});

test('«cancella le pagine di ieri sera» e «di ieri» chiedono l’OK per quel periodo e lasciano il resto', async ({ app }) => {
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  await app.evaluate(async () => {
    const ieri = (h) => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(h, 0, 0, 0); return d.toISOString(); };
    await globalThis.SN_IL_FILO.registraVisita({ url: 'https://mattina.test/', titolo: 'Ieri mattina', ts: ieri(10) });
    await globalThis.SN_IL_FILO.registraVisita({ url: 'https://sera.test/', titolo: 'Ieri sera', ts: ieri(21) });
    await globalThis.SN_IL_FILO.registraVisita({ url: 'https://oggi.test/', titolo: 'Pagina di oggi' });
  });
  // Un intervallo qualsiasi passa da `da`/`a`, con l'ora locale, e il popup dice le ore.
  const da = await app.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T20:00:00`; });
  const sera = { type: 'CANCELLA_PAGINE', da, a: da.replace('T20:00:00', 'T23:59:59') };
  const chiestaSera = await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), sera);
  expect(chiestaSera.needsConfirm).toBe(2);
  expect(chiestaSera.describe).toMatch(/la pagina visitata dal .*20:00 al .*23:59/);
  await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a, { confirmed: true }), sera);
  expect(leggiFilo(userData)).not.toContain('Ieri sera');
  expect(leggiFilo(userData)).toContain('Ieri mattina');

  const chiesta = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CANCELLA_PAGINE', periodo: 'ieri' }));
  expect(chiesta.needsConfirm).toBe(2);
  expect(chiesta.describe).toContain('la pagina visitata di ieri');
  const fatta = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CANCELLA_PAGINE', periodo: 'ieri' }, { confirmed: true }));
  expect(fatta.output.cancellate).toBe(1);
  expect(leggiFilo(userData)).not.toContain('Ieri mattina');
  expect(leggiFilo(userData)).toContain('Pagina di oggi');
});

test('una pagina che si dà il titolo dopo il caricamento, o lo cambia dopo un cambio d’indirizzo interno, porta quello vero', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  const titoli = () => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).map((p) => p.titolo).sort());
  await openTab(testServer.html('<!doctype html><p>app</p><script>setTimeout(()=>{document.title="Posta in arrivo (3)"},700)</script>'));
  await openTab(testServer.html('<!doctype html><title>Caricamento…</title><p>app</p><script>setTimeout(()=>{document.title="Ordine 1234 confermato"},700)</script>'));
  await expect.poll(titoli, { timeout: 20_000 }).toEqual(['Ordine 1234 confermato', 'Posta in arrivo (3)']);

  const page = await openTab(testServer.html('<!doctype html><title>Home video</title><p>x</p>'));
  await expect.poll(async () => (await titoli()).includes('Home video'), { timeout: 20_000 }).toBe(true);
  await page.evaluate(() => {
    history.pushState(null, '', '/video/42');
    document.title = 'Caricamento…';
    setTimeout(() => { document.title = 'Orche al tramonto - Video'; }, 600);
  });
  await expect.poll(titoli, { timeout: 20_000 }).toEqual(['Home video', 'Orche al tramonto - Video', 'Ordine 1234 confermato', 'Posta in arrivo (3)']);
  // Il titolo nuovo è una riga in coda, e riletto dal file vale quello.
  await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
  expect(eventi(userData).filter((e) => e.tipo === 'navigazione.titolo').map((e) => e.titolo)).toContain('Orche al tramonto - Video');
});

test('cancellata una chat dalla Cronologia, il suo testo sparisce anche dalle richieste ai modelli, dalla cache e dal registro grezzo', async ({ app }) => {
  test.setTimeout(90_000);
  await configura(app);
  await turno(app, 'chat-privata', 'La mia diagnosi è arrivata oggi.\nIl medico dice PRIVATO-77, cosa ne pensi?');
  await turno(app, 'chat-da-tenere', 'Parliamo di Epicuro TIENIMI-55');
  await app.evaluate(async () => { await globalThis.SN_CLOSE_FILO_CHAT('chat-privata'); await globalThis.SN_CLOSE_FILO_CHAT('chat-da-tenere'); });
  const voci = () => app.evaluate(async () => (await globalThis.SN_HISTORY.list()).length);
  const prima = await voci();
  await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.FILO_CHAT_DELETE, id: 'chat-privata' }, { url: 'filo://archive/archive.html' }));
  const dove = await app.evaluate(async () => {
    const tutto = await globalThis.chrome.storage.local.get(null);
    return {
      privato: Object.keys(tutto).filter((k) => JSON.stringify(tutto[k]).includes('PRIVATO-77')),
      tenuto: Object.keys(tutto).filter((k) => JSON.stringify(tutto[k]).includes('TIENIMI-55')).sort(),
      segnate: (tutto.aiHistory || []).filter((it) => JSON.stringify(it).includes('[chat cancellata]')).length,
    };
  });
  expect(dove.privato).toEqual([]);
  // L'altra chat resta dov'era, e le richieste della chat cancellata restano coi loro costi, senza il testo.
  expect(dove.tenuto).toEqual(expect.arrayContaining(['aiHistory', 'filo_raw_log']));
  expect(dove.segnate).toBeGreaterThan(0);
  expect(await voci()).toBe(prima);
});
