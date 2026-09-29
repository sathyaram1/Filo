// #787 giro 3 — esplorazione: sequenze insolite (due schede che scrivono insieme, Riprova doppio, svuota a parole e cambio mazzo).

import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, newDeck, ask, storedChats, reloadBuilder } from './aiuti.mjs';

async function secondTab(app, shell) {
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
  return other;
}

test('due schede scrivono insieme sullo stesso mazzo', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);
  await ask(page, 'prima domanda', 1);
  const other = await secondTab(app, shell);
  await expect(other.locator('.dk-msg-user')).toHaveText(['prima domanda']);
  await app.evaluate(() => {
    globalThis.__hang = false;
    const prev = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.__releases = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async (args) => {
      await new Promise((r) => globalThis.__releases.push(r));
      return prev(args);
    };
  });
  await page.fill('#chatInput', 'domanda A');
  await page.press('#chatInput', 'Enter');
  await expect(other.locator('.dk-msg-user')).toHaveText(['prima domanda', 'domanda A']);
  await other.fill('#chatInput', 'domanda B creature con haste');
  await other.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-user')).toHaveText(['prima domanda', 'domanda A', 'domanda B creature con haste']).catch(() => {});
  console.log('[esplora2] A durante:', JSON.stringify(await page.locator('.dk-msg').allInnerTexts()));
  console.log('[esplora2] B durante:', JSON.stringify(await other.locator('.dk-msg').allInnerTexts()));
  await app.evaluate(() => { for (const r of globalThis.__releases.splice(0)) r(); });
  await page.waitForTimeout(2500);
  console.log('[esplora2] A dopo:', JSON.stringify(await page.locator('.dk-msg').allInnerTexts()));
  console.log('[esplora2] B dopo:', JSON.stringify(await other.locator('.dk-msg').allInnerTexts()));
  const saved = await storedChats(app);
  console.log('[esplora2] salvata:', JSON.stringify(saved[deckId].messages.map((m) => m.text || m.reply || (m.pending ? 'PENDING' : m.interrupted ? 'INTERR' : m.error || '?'))));
});

test('Riprova premuto due volte in fretta', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);
  await app.evaluate(() => { globalThis.__hang = true; });
  await page.fill('#chatInput', 'domanda');
  await page.press('#chatInput', 'Enter');
  await reloadBuilder(page);
  await expect(page.locator('.dk-retry')).toHaveCount(1);
  await app.evaluate(() => { globalThis.__hang = false; globalThis.__release && globalThis.__release(); globalThis.__chatCalls = []; });
  await page.locator('.dk-retry').dblclick();
  await page.waitForTimeout(1500);
  console.log('[esplora2] chiamate dopo doppio Riprova:', await app.evaluate(() => globalThis.__chatCalls.length));
  console.log('[esplora2] bolle:', JSON.stringify(await page.locator('.dk-msg').allInnerTexts()));
});

test('svuota a parole, e intanto si cambia mazzo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const prev = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async (args) => {
      const last = String(args.messages[args.messages.length - 1].content || '');
      if (!/svuota/i.test(last)) return prev(args);
      await new Promise((r) => setTimeout(r, 1500));
      return { text: '{"clearChat": true}', model: args.attempts[0].model, provider: args.attempts[0].provider, usage: {} };
    };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const a = await newDeck(page);
  await ask(page, 'creature con haste', 1);
  await page.fill('#chatInput', 'svuota la chat');
  await page.press('#chatInput', 'Enter');
  await page.click('#backToLibrary');
  await page.waitForTimeout(2500);
  const open = await page.evaluate(() => !!(window.SN_CONFIRM_UI && window.SN_CONFIRM_UI._test.state()));
  console.log('[esplora2] conferma aperta in libreria:', open);
  await page.evaluate((id) => { location.hash = `#/deck/${encodeURIComponent(id)}`; }, a);
  await expect(page.locator('#screenBuilder')).toBeVisible();
  await page.waitForTimeout(800);
  console.log('[esplora2] tornato sul mazzo:', JSON.stringify(await page.locator('.dk-msg').allInnerTexts()));
  console.log('[esplora2] conferma aperta al ritorno:', await page.evaluate(() => !!(window.SN_CONFIRM_UI && window.SN_CONFIRM_UI._test.state())));
});
