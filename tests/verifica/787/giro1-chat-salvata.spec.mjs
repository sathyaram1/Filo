// #787 — primo giro: la chat del banco di lavoro resta dopo ricarica e riavvio, mazzo per mazzo.
// Modello e Scryfall finti nel main, messaggi sul cammino IPC vero della pagina.

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';
import { mockScryfall, mockProvider, newDeck, ask, storedChats, reloadBuilder, seedChat } from './aiuti.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('ricarica: bolle, lista aperta, + che aggiunge, nome in prosa vivo, storico al modello', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => { globalThis.__reasoningChunks = ['Penso alle carte ', 'con haste.']; });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);

  await ask(page, 'che ne pensi del mazzo?', 1);
  await ask(page, 'creature con haste', 2);
  const before = await app.evaluate(() => globalThis.__chatCalls[1].length);

  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-user')).toHaveCount(2);
  await expect(page.locator('.dk-msg-bot')).toHaveCount(2);
  await expect(page.locator('.dk-msg-bot').first()).toContainText('a buon punto');
  const last = page.locator('.dk-msg-bot').last();
  await expect(last.locator('.dk-cardlist')).toBeVisible();
  await expect(last.locator('.dk-cardlist .dk-row')).toHaveCount(2);
  await expect(last.locator('.dk-row-name').first()).toHaveText('Lightning Bolt');
  // Ragionamento conservato, chiuso.
  await expect(last.locator('.dk-cot')).toBeVisible();
  await expect(last.locator('.dk-cot-body')).toHaveCount(0);
  await last.locator('.dk-cot').click();
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-cot-body')).toHaveText('Penso alle carte con haste.');

  await page.locator('.dk-msg-bot').last().locator('[data-add="bolt-1"]').click();
  await expect(page.locator('#deckList .dk-row[data-card-id="bolt-1"]')).toBeVisible();
  await expect(page.locator('#deckCount')).toHaveText('1/100 carte');

  // Nome in prosa: passandoci sopra si apre l'anteprima.
  await page.locator('.dk-msg-bot').last().locator('.dk-prose-card').hover();
  await expect(page.locator('#detailTitle')).toHaveText('Anteprima', { timeout: 5000 });

  // Ricarica di nuovo: il toggle dice «già nel mazzo» (stato di adesso).
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-bot').last().locator('[data-add="bolt-1"]')).toHaveAttribute('data-in', '1');

  // La conversazione prosegue: il modello riceve lo storico di prima.
  await ask(page, 'e adesso?', 3);
  const after = await app.evaluate(() => globalThis.__chatCalls[globalThis.__chatCalls.length - 1]);
  const contents = after.map((m) => String(m.content || ''));
  expect(after.length).toBe(before + 2);
  expect(contents.some((c) => c.includes('che ne pensi del mazzo?'))).toBe(true);
  expect(contents.some((c) => c.includes('creature con haste'))).toBe(true);
  expect(contents.some((c) => c.includes('Per la fretta guarda'))).toBe(true);
  // Le liste vecchie sono chiuse sulla riga di sintesi.
  await expect(page.locator('.dk-msg-bot').nth(1).locator('.dk-cardlist')).toBeHidden();
  await expect(page.locator('.dk-msg-bot').nth(1).locator('.dk-list-summary')).toContainText('2 risultati');
});

test('due mazzi: ognuno la sua; svuota con conferma (tre strade); elimina e duplica', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const a = await newDeck(page);
  await ask(page, 'creature con haste', 1);
  await page.click('#backToLibrary');
  const b = await newDeck(page);
  await ask(page, 'che ne pensi del mazzo?', 1);

  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-user')).toHaveText(['che ne pensi del mazzo?']);
  await page.evaluate((id) => { location.hash = `#/deck/${encodeURIComponent(id)}`; }, a);
  await expect(page.locator('.dk-msg-user')).toHaveText(['creature con haste']);
  await expect(page.locator('.dk-msg-bot .dk-cardlist .dk-row')).toHaveCount(2);

  // Svuota dall'icona: annulla → resta; conferma → vuota, anche dopo ricarica.
  await expect(page.locator('#chatClear')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/787-g1-chat-chiaro.png' });
  await page.click('#chatClear');
  await clickConfirm(page, 'cancel');
  await expect(page.locator('.dk-msg-user')).toHaveCount(1);
  await page.click('#chatClear');
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  await expect(page.locator('#chatEmpty')).toBeVisible();
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  expect((await storedChats(app))[a]).toBeUndefined();

  // Tasto destro sull'intestazione della chat.
  await ask(page, 'creature con haste', 1);
  await page.locator('#chatHead').click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Svuota la chat' }).click();
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dk-msg')).toHaveCount(0);

  // Menu del mazzo.
  await ask(page, 'creature con haste', 1);
  await page.click('#deckName');
  await page.locator('.sn-select-option', { hasText: 'Svuota la chat' }).click();
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg')).toHaveCount(0);

  // B è intatto; duplicato di B parte vuoto; eliminato B, la sua chat sparisce dai dati.
  expect((await storedChats(app))[b]).toBeTruthy();
  await page.click('#backToLibrary');
  await page.locator(`[data-deck-id="${b}"]`).click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Duplica' }).click();
  await expect(page.locator('[data-deck-id]')).toHaveCount(3);
  const copy = await page.evaluate((known) => [...document.querySelectorAll('[data-deck-id]')].map((e) => e.dataset.deckId).find((id) => !known.includes(id)), [a, b]);
  await page.locator(`[data-deck-id="${copy}"]`).click();
  await expect(page.locator('#screenBuilder')).toBeVisible();
  await expect(page.locator('#chatEmpty')).toBeVisible();
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  await page.click('#backToLibrary');
  await page.locator(`[data-deck-id="${b}"]`).click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Elimina' }).click();
  await clickConfirm(page, 'ok');
  await expect(page.locator('[data-deck-id]')).toHaveCount(2);
  await expect.poll(async () => Object.keys(await storedChats(app))).not.toContain(b);
});

test('pagina chiusa mentre Filo risponde: niente «sta pensando» eterno, e Riprova', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);
  await app.evaluate(() => { globalThis.__hang = true; });
  await page.fill('#chatInput', 'creature con haste');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last()).toContainText('sta pensando');
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-user')).toHaveText(['creature con haste']);
  await expect(page.locator('.dk-msg-bot')).toHaveCount(1);
  await expect(page.locator('.dk-msg-bot')).not.toContainText('sta pensando');
  await expect(page.locator('.dk-msg-bot')).toContainText('interrotta');
  await page.screenshot({ path: 'tests/.shots/787-g1-interrotta.png' });
  // La risposta vecchia arriva dopo la ricarica: non deve riscrivere niente di strano.
  await app.evaluate(() => { globalThis.__hang = false; globalThis.__release && globalThis.__release(); });
  await page.waitForTimeout(800);
  await page.click('.dk-retry');
  await expect(page.locator('.dk-msg-bot')).toHaveCount(1);
  await expect(page.locator('.dk-msg-bot .dk-cardlist .dk-row')).toHaveCount(2);
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-user')).toHaveCount(1);
  await expect(page.locator('.dk-msg-bot .dk-cardlist .dk-row')).toHaveCount(2);
});

test('testo insolito: HTML ed emoji si rileggono come testo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);
  const evil = '<img src=x onerror="window.__xss=1"> 🐉 <b>ciao</b> ' + 'x'.repeat(3000);
  await ask(page, evil, 1);
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-user')).toHaveText([evil]);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('tema scuro: intestazione con la gomma e bolla interrotta', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);
  await ask(page, 'creature con haste', 1);
  await app.evaluate(() => { globalThis.__hang = true; });
  await page.fill('#chatInput', 'altro');
  await page.press('#chatInput', 'Enter');
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-bot').last()).toContainText('interrotta');
  await page.locator('#chatClear').hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/787-g1-scuro.png' });
  await app.evaluate(() => { globalThis.__hang = false; globalThis.__release && globalThis.__release(); });
});

test('riavvio di Filo: stessa chat, + che aggiunge, ogni mazzo la sua', async () => {
  test.setTimeout(150_000);
  const userData = cartellaTemporanea('filo-787-');
  const launch = () => electron.launch({
    args: [...argomentiScala, '.'], cwd: ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const openDecks = async (app, hash = '') => {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), 'filo://decks/decks.html' + hash);
    let page = null;
    for (let i = 0; i < 100 && !page; i += 1) {
      page = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'decks'; } catch (_) { return false; } });
      if (!page) await new Promise((r) => setTimeout(r, 100));
    }
    await page.waitForLoadState('domcontentloaded');
    return page;
  };
  let app = await launch();
  let a; let b;
  try {
    await mockScryfall(app);
    await mockProvider(app);
    const page = await openDecks(app);
    a = await newDeck(page);
    await ask(page, 'creature con haste', 1);
    await page.click('#backToLibrary');
    b = await newDeck(page);
    await ask(page, 'che ne pensi del mazzo?', 1);
    await page.waitForTimeout(600);
  } finally {
    await chiudiApp(app);
  }
  app = await launch();
  try {
    await mockScryfall(app);
    await mockProvider(app);
    const page = await openDecks(app, `#/deck/${encodeURIComponent(a)}`);
    await expect(page.locator('#screenBuilder')).toBeVisible();
    await expect(page.locator('.dk-msg-user')).toHaveText(['creature con haste']);
    const last = page.locator('.dk-msg-bot').last();
    await expect(last.locator('.dk-cardlist .dk-row')).toHaveCount(2);
    await expect(last.locator('.dk-row-name').first()).toHaveText('Lightning Bolt');
    await last.locator('[data-add="crasher-1"]').click();
    await expect(page.locator('#deckList .dk-row[data-card-id="crasher-1"]')).toBeVisible();
    await page.evaluate((id) => { location.hash = `#/deck/${encodeURIComponent(id)}`; }, b);
    await expect(page.locator('.dk-msg-user')).toHaveText(['che ne pensi del mazzo?']);
    await ask(page, 'e poi?', 2);
    const hist = await app.evaluate(() => globalThis.__chatCalls[globalThis.__chatCalls.length - 1].map((m) => String(m.content || '')));
    expect(hist.some((c) => c.includes('che ne pensi del mazzo?'))).toBe(true);
    expect(hist.some((c) => c.includes('creature con haste'))).toBe(false);
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('tetto: oltre i 5000 messaggi la chat lo dice', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);
  await seedChat(app, deckId, 5000);
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-user')).toHaveCount(2500, { timeout: 60_000 });
  await expect(page.locator('.dk-chat-cap')).toHaveCount(0);
  await ask(page, 'che ne pensi del mazzo?', 2501);
  await expect(page.locator('.dk-chat-cap')).toContainText('5.000 messaggi');
});

test('clic sul nome in prosa dopo ricarica apre il carosello', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);
  await ask(page, 'creature con haste', 1);
  await reloadBuilder(page);
  await page.locator('.dk-msg-bot .dk-prose-card').click();
  await expect(page.locator('#detailTitle')).toHaveText('Carosello');
  await page.mouse.move(900, 500);
  await page.waitForTimeout(1500);
  await expect(page.locator('#detailTitle')).toHaveText('Carosello');
  await expect(page.locator('#stateCarousel')).toContainText('Lightning Bolt');
});

test('svuota, cambia mazzo o elimina mentre Filo risponde', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const a = await newDeck(page);
  // Svuota durante la risposta.
  await app.evaluate(() => { globalThis.__hang = true; });
  await page.fill('#chatInput', 'creature con haste');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot')).toContainText('sta pensando');
  await page.click('#chatClear');
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  await app.evaluate(() => { globalThis.__hang = false; globalThis.__release && globalThis.__release(); });
  await page.waitForTimeout(800);
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  expect((await storedChats(app))[a]).toBeUndefined();

  // Cambio mazzo durante la risposta: la risposta resta nel mazzo A.
  await app.evaluate(() => { globalThis.__hang = true; });
  await page.fill('#chatInput', 'creature con haste');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot')).toContainText('sta pensando');
  await page.click('#backToLibrary');
  const b = await newDeck(page);
  await app.evaluate(() => { globalThis.__hang = false; globalThis.__release && globalThis.__release(); });
  await page.waitForTimeout(800);
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  const st = await storedChats(app);
  expect(st[a].messages.map((m) => m.text || m.reply)).toEqual(['creature con haste', 'Per la fretta guarda [[Lightning Bolt]].']);
  expect(st[b]).toBeUndefined();
  await page.evaluate((id) => { location.hash = `#/deck/${encodeURIComponent(id)}`; }, a);
  await expect(page.locator('.dk-msg-bot .dk-cardlist .dk-row')).toHaveCount(2);

  // Elimina il mazzo mentre Filo risponde: la chat non rinasce nei dati.
  await app.evaluate(() => { globalThis.__hang = true; });
  await page.fill('#chatInput', 'che ne pensi del mazzo?');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last()).toContainText('sta pensando');
  await page.click('#deckName');
  await page.locator('.sn-select-option', { hasText: 'Elimina' }).click();
  await clickConfirm(page, 'ok');
  await expect(page.locator('#screenLibrary')).toBeVisible();
  await app.evaluate(() => { globalThis.__hang = false; globalThis.__release && globalThis.__release(); });
  await page.waitForTimeout(1000);
  expect(Object.keys(await storedChats(app))).not.toContain(a);
});

test('riavvio senza rete: le righe si leggono dalla cache', async () => {
  test.setTimeout(150_000);
  const userData = cartellaTemporanea('filo-787b-');
  const launch = () => electron.launch({
    args: [...argomentiScala, '.'], cwd: ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const openDecks = async (app, hash = '') => {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), 'filo://decks/decks.html' + hash);
    let page = null;
    for (let i = 0; i < 100 && !page; i += 1) {
      page = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'decks'; } catch (_) { return false; } });
      if (!page) await new Promise((r) => setTimeout(r, 100));
    }
    await page.waitForLoadState('domcontentloaded');
    return page;
  };
  let app = await launch();
  let a;
  try {
    await mockScryfall(app);
    await mockProvider(app);
    const page = await openDecks(app);
    a = await newDeck(page);
    await ask(page, 'creature con haste', 1);
    await page.locator('.dk-msg-bot [data-add="bolt-1"]').click();
    await expect(page.locator('#deckCount')).toHaveText('1/100 carte');
    await page.waitForTimeout(1500);
  } finally {
    await chiudiApp(app);
  }
  app = await launch();
  try {
    await app.evaluate(() => { globalThis.SN_SCRYFALL._setFetch(async () => ({ ok: false, status: 503, json: async () => ({}) })); });
    const page = await openDecks(app, `#/deck/${encodeURIComponent(a)}`);
    await expect(page.locator('#screenBuilder')).toBeVisible();
    await expect(page.locator('.dk-msg-bot .dk-row-name')).toHaveText(['Lightning Bolt', 'Embercleave Crasher']);
    await expect(page.locator('.dk-msg-bot [data-add="bolt-1"]')).toHaveAttribute('data-in', '1');
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
