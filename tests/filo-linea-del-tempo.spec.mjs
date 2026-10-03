// #866 — il filo: chat della home e pagine visitate in una linea del tempo sua, su disco appena esistono, senza
// tetti, cancellabili davvero, esportabili, e mai su disco dall'incognito. Ogni prova guarda il FILE, non solo l'app.
// Senza il filo ogni prova è rossa: le chat stavano in storage.json e le pagine visitate non si registravano.

import { test, expect, chiudiApp, argomentiScala } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { clickConfirm, confirmText } from './helpers/confirm.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fileFilo = (userData) => join(userData, 'filo', 'eventi.jsonl');
const leggiFilo = (userData) => (existsSync(fileFilo(userData)) ? readFileSync(fileFilo(userData), 'utf8') : '');
const eventi = (userData) => leggiFilo(userData).split('\n').filter(Boolean).map((r) => JSON.parse(r));

async function avvia(userData) {
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const shell = await app.firstWindow();
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

    app.evaluate(() => { globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'Seconda domanda RESTA-APPESA', threadHistory: [], chatId: 'chat-crash' }); });
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
