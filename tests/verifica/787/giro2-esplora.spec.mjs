// #787 giro 2 — esplorazione: aspetto, seconda scheda durante una risposta, quantità dell'import, chat lunghe.

import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, newDeck, ask, reloadBuilder, seedChat } from './aiuti.mjs';

test('aspetto chiaro e scuro: lista, interrotta, gomma', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => { globalThis.__reasoningChunks = ['Penso alle carte ', 'con haste.']; });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);
  await ask(page, 'creature con haste', 1);
  await ask(page, 'come ti sembra?', 2);
  await app.evaluate(() => { globalThis.__hang = true; });
  await page.fill('#chatInput', 'altre con haste');
  await page.press('#chatInput', 'Enter');
  await reloadBuilder(page);
  await page.locator('#chatClear').hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/787-g2-chiaro.png' });
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  await page.waitForTimeout(600);
  await page.locator('.dk-retry').hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/787-g2-scuro.png' });
  await app.evaluate(() => { globalThis.__hang = false; globalThis.__release && globalThis.__release(); });
});

test('seconda scheda sullo stesso mazzo mentre Filo risponde nella prima', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);
  await ask(page, 'prima domanda', 1);
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
  await expect(other.locator('.dk-msg-user')).toHaveText(['prima domanda']);
  await app.evaluate(() => { globalThis.__hang = true; });
  await page.fill('#chatInput', 'creature con haste');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last()).toContainText('sta pensando');
  await other.waitForTimeout(1500);
  const lastOther = await other.locator('.dk-msg-bot').last().innerText();
  console.log('SECONDA SCHEDA, ultima bolla:', JSON.stringify(lastOther));
  console.log('SECONDA SCHEDA, riprova visibile:', await other.locator('.dk-retry').count());
  await other.screenshot({ path: 'tests/.shots/787-g2-seconda-scheda.png' });
  await app.evaluate(() => { globalThis.__hang = false; globalThis.__release && globalThis.__release(); });
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-cardlist .dk-row')).toHaveCount(2);
  await expect(other.locator('.dk-msg-bot').last().locator('.dk-cardlist .dk-row')).toHaveCount(2);
});

test('import con quantità: cambiata la quantità nel mazzo, il tasto e le righe', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const prev = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async (args) => {
      const last = String(args.messages[args.messages.length - 1].content || '');
      if (!/importa/i.test(last)) return prev(args);
      const text = JSON.stringify({ reply: 'Ecco la lista.', import: [{ name: 'Lightning Bolt', qty: 3 }, { name: 'Embercleave Crasher', qty: 1 }] });
      return { text, model: args.attempts[0].model, provider: args.attempts[0].provider, usage: {} };
    };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);
  await ask(page, 'importa questa lista: 3 Lightning Bolt, 1 Embercleave Crasher', 1);
  console.log('righe import:', await page.locator('.dk-msg-bot .dk-row').allInnerTexts());
  await page.locator('.dk-import-all').click();
  console.log('dopo import:', await page.locator('#deckCount').innerText(), await page.locator('.dk-import-all').innerText());
  await reloadBuilder(page);
  console.log('dopo ricarica:', await page.locator('#deckCount').innerText(), await page.locator('.dk-import-all').innerText(), await page.locator('.dk-import-all').isDisabled());
  // L'utente abbassa la quantità nel mazzo (qui dal main, come farebbe il suo controllo).
  await app.evaluate(async (_e, id) => {
    const d = await globalThis.SN_DECK_STORE.get(id);
    d.carte = d.carte.map((c) => (c.scryfall_id === 'bolt-1' ? { ...c, qty: 1 } : c));
    await globalThis.SN_DECK_STORE.put(d);
  }, deckId);
  await reloadBuilder(page);
  console.log('quantità abbassata:', await page.locator('#deckCount').innerText(), JSON.stringify(await page.locator('.dk-import-all').innerText()), await page.locator('.dk-import-all').isDisabled(),
    await page.locator('.dk-msg-bot [data-add]').evaluateAll((els) => els.map((e) => `${e.dataset.add}:${e.dataset.in}:${e.textContent}`)));
  await page.screenshot({ path: 'tests/.shots/787-g2-import-qty.png' });
});

test('chat lunga: apertura e ridisegno', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);
  for (const n of [400, 2000, 4990]) {
    await seedChat(app, deckId, n, { reasoning: 1500, ids: 20 });
    const t0 = Date.now();
    await reloadBuilder(page);
    await expect(page.locator('.dk-msg-user')).toHaveCount(n / 2);
    const open = Date.now() - t0;
    const redraw = await page.evaluate(() => {
      const el = document.querySelectorAll('[data-toggle-list]');
      const t = performance.now();
      el[el.length - 2].click();
      return performance.now() - t;
    });
    console.log(`CHAT ${n}: apertura ${open} ms, ridisegno ${redraw.toFixed(0)} ms`);
  }
});

test('chat lunga: ragionamento in diretta', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const prev = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (args) => {
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => setTimeout(r, 75));
        try { args.onReasoning && args.onReasoning(`pezzo ${i} del ragionamento `); } catch (_) {}
      }
      return prev({ ...args, onReasoning: null });
    };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);
  for (const n of [200, 1000, 2000]) {
    await seedChat(app, deckId, n, { reasoning: 1500, ids: 20 });
    await reloadBuilder(page);
    await expect(page.locator('.dk-msg-user')).toHaveCount(n / 2);
    await page.evaluate(() => {
      window.__lt = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: false });
    });
    await page.fill('#chatInput', 'creature con haste');
    await page.press('#chatInput', 'Enter');
    await expect(page.locator('.dk-msg-user')).toHaveCount(n / 2 + 1);
    await expect(page.locator('.dk-msg-bot').last().locator('.dk-msg-pending', { hasText: 'sta pensando' })).toHaveCount(0, { timeout: 60_000 });
    const lt = await page.evaluate(() => window.__lt);
    const tot = lt.reduce((a, b) => a + b, 0);
    console.log(`STREAM ${n}: ${lt.length} compiti lunghi, ${tot.toFixed(0)} ms bloccati su ~3000 ms, max ${Math.max(0, ...lt).toFixed(0)} ms`);
  }
});
