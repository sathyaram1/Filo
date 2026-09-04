// #336 — scroll durante la generazione. Mentre Filo genera (ragionamento in
// streaming + risultati), la chat si ricostruisce di continuo; prima del fix ogni
// ricostruzione strappava la vista in fondo (e, per via dello svuotamento, un
// istante in cima), rendendo impossibile scrollare per leggere mentre genera.
//
// SUCCESSO che si asserisce: se l'utente ha scrollato SU durante la generazione,
// la sua posizione viene conservata (non torna in fondo). E — invariante da non
// regredire — se resta in fondo, la vista continua a SEGUIRE i nuovi contenuti.
//
// Il provider LLM e Scryfall sono mockati nel main (niente rete); la generazione
// è messa in pausa su un "gate" così il test può scrollare a metà strada, come
// farebbe l'utente, e poi lasciarla proseguire.

import { test, expect } from './fixtures/electron.mjs';

async function mockScryfall(app) {
  await app.evaluate(() => {
    // Tante carte rosse (dentro l'identità U/R del commander) così la CardList
    // finale è alta e la colonna chat resta scrollabile a generazione finita.
    const cards = [];
    for (let i = 1; i <= 40; i++) {
      cards.push({
        id: `c${i}`, name: `Carta Rossa ${i}`, mana_cost: '{R}', cmc: (i % 7),
        type_line: 'Creature — Goblin', colors: ['R'], color_identity: ['R'],
        image_uris: { normal: `https://cards.test/c${i}.jpg` },
        prices: { eur: '0.10' }, legalities: { commander: 'legal' },
        scryfall_uri: `https://scryfall.com/card/c${i}`,
      });
    }
    const NIV = {
      id: 'niv-1', name: 'Niv-Mizzet, Parun', mana_cost: '{U}{U}{U}{R}{R}{R}', cmc: 6,
      type_line: 'Legendary Creature — Dragon Wizard', colors: ['U', 'R'], color_identity: ['U', 'R'],
      image_uris: { normal: 'https://cards.test/niv.jpg', art_crop: 'https://cards.test/niv-art.jpg' },
      prices: { eur: '3.21' }, legalities: { commander: 'legal' },
      scryfall_uri: 'https://scryfall.com/card/niv',
    };
    const BY_ID = { 'niv-1': NIV };
    for (const c of cards) BY_ID[c.id] = c;
    globalThis.__scryRequests = [];
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      globalThis.__scryRequests.push(String(url));
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') body = { data: cards, has_more: false };
      else if (BY_ID[u.pathname.replace('/cards/', '')]) body = BY_ID[u.pathname.replace('/cards/', '')];
      else if (u.pathname === '/symbology') {
        body = { data: [
          { symbol: '{U}', svg_uri: 'https://svgs.test/U.svg' },
          { symbol: '{R}', svg_uri: 'https://svgs.test/R.svg' },
        ] };
      }
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  });
}

// Provider con "gate": emette un blocco DI RAGIONAMENTO lungo (così la colonna
// chat va in overflow mentre Filo "pensa"), poi si ferma sulla promise finché il
// test non la rilascia, quindi torna la risposta con una query → CardList.
async function mockGatedProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__gate = new Promise((res) => { globalThis.__releaseGate = res; });
    globalThis.__callN = 0;
    globalThis.__bigReasoning = Array.from({ length: 60 },
      (_, i) => `Passo ${i}: valuto una carta rossa con haste per il mazzo Izzet.`).join('\n');
    // Risposta di "riscaldamento": prosa MOLTO lunga (non ha tetto d'altezza,
    // resta sempre visibile) → la colonna chat va in overflow e ci resta, così
    // scrollare ha senso sia mentre Filo pensa sia a generazione finita. La
    // CardList e il ragionamento hanno invece uno scroll INTERNO (tetto CSS), da
    // soli non fanno traboccare la colonna.
    globalThis.__warmProse = Array.from({ length: 120 },
      (_, i) => `Riga ${i} di contesto sul mazzo Izzet e sulle sue linee di gioco.`).join('\n');
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => ({
      text: JSON.stringify({ reply: 'Ecco delle carte rosse con haste.', query: 'o:haste' }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onReasoning }) => {
      globalThis.__callN++;
      if (globalThis.__callN === 1) {
        // Turno di riscaldamento: nessun gate, solo prosa alta per l'overflow.
        const r = { text: JSON.stringify({ reply: globalThis.__warmProse }),
          model: attempts[0].model, provider: attempts[0].provider, usage: {} };
        if (onDelta) onDelta(r.text);
        return r;
      }
      // Turno "vero", messo in pausa a metà: Fase 1 ragionamento in diretta…
      if (onReasoning) onReasoning(globalThis.__bigReasoning);
      // …attende che il test scrolli su, imitando l'utente che legge a metà…
      await globalThis.__gate;
      // …Fase 2: altro ragionamento + risposta (che innescano altri rerender).
      if (onReasoning) onReasoning('\nConcludo la selezione.');
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text);
      return r;
    };
  });
}

// Turno di riscaldamento: una prosa lunga che fa (e tiene) la chat in overflow.
async function warmUp(page) {
  await page.fill('#chatInput', 'raccontami del mazzo');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-msg-text')).toBeVisible();
}

async function deckWithCommander(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  const deckId = decodeURIComponent(hash.replace('#/deck/', ''));
  const r = await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    return chrome.runtime.sendMessage({ type: MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1' });
  }, deckId);
  expect(r && r.ok, 'set commander deve riuscire: ' + JSON.stringify(r)).toBe(true);
  return deckId;
}

const scrollInfo = (page) => page.evaluate(() => {
  const el = document.getElementById('chatLog');
  return { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight };
});

test('scrollando su mentre genera, la vista NON torna in fondo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockGatedProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await warmUp(page); // prosa lunga: la colonna chat va in overflow e ci resta
  await expect.poll(async () => { const s = await scrollInfo(page); return s.height - s.client; },
    { timeout: 10_000, message: 'la chat deve andare in overflow' }).toBeGreaterThan(80);

  // Parte la generazione "vera" (non attendo il completamento: si ferma sul gate).
  await page.fill('#chatInput', 'modi per dare haste alle creature');
  await page.press('#chatInput', 'Enter');

  // Compare la bolla in generazione col ragionamento in diretta.
  const cotBody = page.locator('.dk-msg-bot').last().locator('.dk-cot-body');
  await expect(cotBody).toBeVisible();

  // L'utente scrolla in cima per rileggere mentre Filo genera.
  await page.evaluate(() => { document.getElementById('chatLog').scrollTop = 0; });
  await expect.poll(async () => (await scrollInfo(page)).top).toBeLessThan(20);

  // La generazione prosegue: arrivano altro ragionamento e i risultati.
  await app.evaluate(() => globalThis.__releaseGate());
  const list = page.locator('.dk-msg-bot').last().locator('.dk-cardlist .dk-row');
  await expect(list.first()).toBeVisible();
  await expect(list).toHaveCount(40);

  // La colonna è ancora scrollabile (CardList alta) e — QUI il fix — la vista è
  // rimasta dove l'utente l'aveva lasciata (in cima), non è stata strappata in
  // fondo a ogni rerender.
  const s = await scrollInfo(page);
  expect(s.height - s.client, 'la chat resta scrollabile a fine generazione').toBeGreaterThan(60);
  expect(s.top, 'la posizione di scroll dell\'utente va conservata, non riportata in fondo')
    .toBeLessThan(60);
  await page.screenshot({ path: 'tests/.shots/decks-chat-scroll-preservato.png' });
});

test('restando in fondo, la vista SEGUE i nuovi contenuti mentre genera', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockGatedProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await warmUp(page);
  await expect.poll(async () => { const s = await scrollInfo(page); return s.height - s.client; },
    { timeout: 10_000 }).toBeGreaterThan(80);

  await page.fill('#chatInput', 'modi per dare haste alle creature');
  await page.press('#chatInput', 'Enter');

  const cotBody = page.locator('.dk-msg-bot').last().locator('.dk-cot-body');
  await expect(cotBody).toBeVisible();
  // NON scrollo: l'utente resta in fondo. Rilascio e lascio finire.
  await app.evaluate(() => globalThis.__releaseGate());
  const list = page.locator('.dk-msg-bot').last().locator('.dk-cardlist .dk-row');
  await expect(list).toHaveCount(40);

  // Resta scrollabile e la vista è in fondo (auto-follow non regredito).
  const s = await scrollInfo(page);
  expect(s.height - s.client).toBeGreaterThan(60);
  expect(s.height - s.top - s.client, 'chi resta in fondo continua a seguire i contenuti')
    .toBeLessThan(60);
});
