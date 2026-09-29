// #787 — quarto giro: porte nuove sulla chat salvata (due schede che chiedono insieme, scheda chiusa, riavvio a
// metà, apertura di una chat lunga, errore salvato, aspetto della bolla «svuota»).

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';
import { mockScryfall, mockProvider, newDeck, ask, storedChats, reloadBuilder, seedChat } from './aiuti.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function duplicateTab(app, shell) {
  const before = new Set(app.windows());
  await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.duplicate(snap.activeId);
  });
  let other = null;
  await expect.poll(() => {
    other = app.windows().find((w) => !before.has(w) && w.url().startsWith('filo://decks/')) || null;
    return Boolean(other);
  }).toBe(true);
  await other.waitForLoadState('domcontentloaded');
  await expect(other.locator('#screenBuilder')).toBeVisible();
  return other;
}

async function holdable(app) {
  await app.evaluate(() => {
    globalThis.__releases = [];
    const prev = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async (args) => {
      if (globalThis.__hold) await new Promise((r) => globalThis.__releases.push(r));
      return prev(args);
    };
  });
}

test('due schede sullo stesso mazzo chiedono insieme: tutte e due le risposte restano, in ordine', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await holdable(app);
  const a = await openTab('filo://decks/decks.html');
  await a.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(a);
  await ask(a, 'prima', 1);
  const b = await duplicateTab(app, shell);
  await expect(b.locator('.dk-msg-user')).toHaveText(['prima']);

  await app.evaluate(() => { globalThis.__hold = true; });
  await a.fill('#chatInput', 'creature con haste');
  await a.press('#chatInput', 'Enter');
  await expect(b.locator('.dk-msg-bot').last()).toContainText('sta pensando');
  await b.fill('#chatInput', 'seconda domanda');
  await b.press('#chatInput', 'Enter');
  await expect(a.locator('.dk-msg-user')).toHaveText(['prima', 'creature con haste', 'seconda domanda']);
  await app.evaluate(() => { globalThis.__hold = false; globalThis.__releases.splice(0).forEach((r) => r()); });

  for (const p of [a, b]) {
    await expect(p.locator('.dk-msg-user')).toHaveText(['prima', 'creature con haste', 'seconda domanda']);
    await expect(p.locator('.dk-msg-bot')).toHaveCount(3);
    await expect(p.locator('.dk-msg-bot', { hasText: 'sta pensando' })).toHaveCount(0);
    await expect(p.locator('.dk-msg-bot', { hasText: 'interrotta' })).toHaveCount(0);
    await expect(p.locator('.dk-msg-bot').nth(1).locator('.dk-list-summary')).toContainText('2 risultati');
    await expect(p.locator('.dk-msg-bot').last()).toContainText('a buon punto');
  }
  const saved = (await storedChats(app))[deckId].messages;
  expect(saved.map((m) => m.who)).toEqual(['user', 'bot', 'user', 'bot', 'user', 'bot']);
  expect(saved.filter((m) => m.pending || m.interrupted)).toHaveLength(0);
  await reloadBuilder(a);
  await expect(a.locator('.dk-msg-user')).toHaveText(['prima', 'creature con haste', 'seconda domanda']);
  await expect(a.locator('.dk-msg-bot').nth(1).locator('.dk-list-summary')).toContainText('2 risultati');
});

test('scheda chiusa mentre Filo risponde: riaperta è «interrotta», la risposta tardiva non rientra, Riprova la rifà', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);
  await ask(page, 'prima', 1);
  await app.evaluate(() => { globalThis.__hang = true; });
  await page.fill('#chatInput', 'creature con haste');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last()).toContainText('sta pensando');
  await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => String(x.url || '').startsWith('filo://decks/'));
    await window.filoShell.tabs.close(t.id);
  });
  await expect.poll(() => page.isClosed()).toBe(true);
  const again = await openTab(`filo://decks/decks.html#/deck/${encodeURIComponent(deckId)}`);
  await expect(again.locator('#screenBuilder')).toBeVisible();
  await expect(again.locator('.dk-msg-user')).toHaveText(['prima', 'creature con haste']);
  await expect(again.locator('.dk-msg-bot').last()).toContainText('interrotta');
  await app.evaluate(() => { globalThis.__hang = false; globalThis.__release && globalThis.__release(); });
  await again.waitForTimeout(800);
  await expect(again.locator('.dk-msg-bot').last()).toContainText('interrotta');
  await again.click('.dk-retry');
  await expect(again.locator('.dk-msg-bot').last().locator('.dk-cardlist .dk-row')).toHaveCount(2);
  await reloadBuilder(again);
  await expect(again.locator('.dk-msg-user')).toHaveText(['prima', 'creature con haste']);
  await expect(again.locator('.dk-msg-bot').last().locator('.dk-cardlist .dk-row')).toHaveCount(2);
});

test('errore del modello: resta dopo la ricarica con Riprova, che poi funziona', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    globalThis.__fail = true;
    const prev = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async (args) => {
      if (globalThis.__fail) throw Object.assign(new Error('HTTP 402 insufficient credits'), { status: 402 });
      return prev(args);
    };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);
  await page.fill('#chatInput', 'creature con haste');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot .dk-msg-error')).toBeVisible();
  const errText = await page.locator('.dk-msg-bot .dk-msg-error').textContent();
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-bot .dk-msg-error')).toHaveText(errText);
  await app.evaluate(() => { globalThis.__fail = false; });
  await page.click('.dk-retry');
  await expect(page.locator('.dk-msg-bot')).toHaveCount(1);
  await expect(page.locator('.dk-msg-bot .dk-cardlist .dk-row')).toHaveCount(2);
});

test('chat lunga riaperta: si apre in fretta e mostra l\'ultimo scambio', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);
  await seedChat(app, deckId, 4990, { reasoning: 400, ids: 3 });
  const t0 = Date.now();
  await page.reload();
  await expect(page.locator('#screenBuilder')).toBeVisible();
  await expect(page.locator('.dk-msg-bot')).toHaveCount(2495);
  const ms = Date.now() - t0;
  const pos = await page.evaluate(() => {
    const log = document.getElementById('chatLog');
    const last = [...log.querySelectorAll('.dk-msg-bot')].pop().getBoundingClientRect();
    const box = log.getBoundingClientRect();
    return { gap: log.scrollHeight - log.scrollTop - log.clientHeight, lastVisible: last.top < box.bottom && last.bottom > box.top };
  });
  console.log('apertura ms', ms, JSON.stringify(pos));
  expect(pos.lastVisible).toBe(true);
  expect(ms).toBeLessThan(8000);
  await ask(page, 'e adesso?', 2496);
  await expect(page.locator('.dk-chat-cap')).toHaveCount(0);
});

test('riavvio con una risposta in volo: al ritorno è «interrotta» e Riprova la rifà', async () => {
  test.setTimeout(150_000);
  const userData = cartellaTemporanea('filo-787g4-');
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
  let deckId;
  try {
    await mockScryfall(app);
    await mockProvider(app);
    const page = await openDecks(app);
    deckId = await newDeck(page);
    await ask(page, 'prima', 1);
    await app.evaluate(() => { globalThis.__hang = true; });
    await page.fill('#chatInput', 'creature con haste');
    await page.press('#chatInput', 'Enter');
    await expect(page.locator('.dk-msg-bot').last()).toContainText('sta pensando');
    await page.waitForTimeout(600);
  } finally {
    await chiudiApp(app);
  }
  app = await launch();
  try {
    await mockScryfall(app);
    await mockProvider(app);
    const page = await openDecks(app, `#/deck/${encodeURIComponent(deckId)}`);
    await expect(page.locator('#screenBuilder')).toBeVisible();
    await expect(page.locator('.dk-msg-user')).toHaveText(['prima', 'creature con haste']);
    await expect(page.locator('.dk-msg-bot').last()).toContainText('interrotta');
    await page.click('.dk-retry');
    await expect(page.locator('.dk-msg-bot').last().locator('.dk-cardlist .dk-row')).toHaveCount(2);
    await expect(page.locator('.dk-msg-user')).toHaveText(['prima', 'creature con haste']);
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

for (const theme of ['light', 'dark']) {
  test(`aspetto (${theme}): bolla «svuota la chat» annullata`, async ({ app, shell, openTab }) => {
    test.setTimeout(60_000);
    await mockScryfall(app);
    await mockProvider(app);
    await app.evaluate(async (_e, theme) => {
      await globalThis.SN_STORAGE.updateSettings({ theme });
      const prev = globalThis.SN_PROVIDERS.completeWithFallback;
      globalThis.SN_PROVIDERS.completeWithFallback = async (args) => {
        const last = String(args.messages[args.messages.length - 1].content || '');
        if (!/svuota/i.test(last)) return prev(args);
        return { text: '{"clearChat": true}', model: args.attempts[0].model, provider: args.attempts[0].provider, usage: {} };
      };
    }, theme);
    const page = await openTab('filo://decks/decks.html');
    await page.waitForLoadState('domcontentloaded');
    await newDeck(page);
    await ask(page, 'creature con haste', 1);
    const b = await duplicateTab(app, shell);
    await page.fill('#chatInput', 'svuota la chat');
    await page.press('#chatInput', 'Enter');
    await clickConfirm(page, 'cancel');
    await expect(page.locator('.dk-msg-bot').last().locator('[data-clear-chat]')).toBeVisible();
    await expect(b.locator('.dk-msg-bot').last().locator('[data-clear-chat]')).toBeVisible();
    await page.locator('.dk-msg-bot').last().locator('[data-clear-chat]').hover();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/787-g4-svuota-${theme}.png` });
    await page.locator('.dk-msg-bot').last().locator('[data-clear-chat]').click();
    await clickConfirm(page, 'ok');
    await expect(page.locator('.dk-msg')).toHaveCount(0);
    await expect(b.locator('.dk-msg')).toHaveCount(0);
  });
}
