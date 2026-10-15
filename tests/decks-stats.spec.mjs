// Statistiche del Builder (task 7, DECK-BUILDER-SPEC.md §9): stato di riposo
// del pannello destro con le card verticali (curva CMC, colori richiesti/
// prodotti, composizione per tipo, totale /100, legalità), modulo budget
// (§9.2: tetto dallo switcher E via chat, totale/residuo visibili) e
// calcolatore di probabilità Monte Carlo (§9.3: sotto-pannello + via chat).
// Scryfall e provider LLM mockati nel main (niente rete), ma i messaggi
// viaggiano sul cammino IPC reale. Si asserisce il SUCCESSO: i numeri delle
// statistiche sono quelli GIUSTI per il mazzo seminato (non "compare qualcosa"),
// la probabilità è un caso deterministico al 100%.

import { test, expect } from './fixtures/electron.mjs';

const CARDS = {
  'c-bolt': {
    id: 'c-bolt', name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1,
    type_line: 'Instant', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/bolt.jpg' },
    prices: { eur: '1.50' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/bolt',
  },
  'c-dragon': {
    id: 'c-dragon', name: 'Shivan Dragon', mana_cost: '{4}{R}{R}', cmc: 6,
    type_line: 'Creature — Dragon', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/dragon.jpg' },
    prices: { eur: '0.90' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/dragon',
  },
  'c-mountain': {
    id: 'c-mountain', name: 'Mountain', mana_cost: '', cmc: 0,
    type_line: 'Basic Land — Mountain', colors: [], color_identity: ['R'],
    produced_mana: ['R'],
    image_uris: { normal: 'https://cards.test/mountain.jpg' },
    prices: { eur: '0.10' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/mountain',
  },
};

async function mockScryfall(app) {
  await app.evaluate((electron, cardsJson) => {
    const CARDS = JSON.parse(cardsJson);
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      const m = /^\/cards\/([^/]+)$/.exec(u.pathname);
      if (m && CARDS[m[1]]) body = CARDS[m[1]];
      else if (u.pathname === '/symbology') {
        body = { data: [
          { symbol: '{R}', svg_uri: 'https://svgs.test/R.svg' },
          { symbol: '{4}', svg_uri: 'https://svgs.test/4.svg' },
        ] };
      }
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  }, JSON.stringify(CARDS));
}

// Provider LLM finto per la chat: "budget" → intenzione budget (il TETTO lo
// applica il sistema, §9.2); "probabilità" → richiesta prob (la simulazione
// gira nel main, §9.3).
async function mockProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const last = String(messages[messages.length - 1].content || '');
      let text;
      if (/budget/i.test(last)) text = JSON.stringify({ reply: '', budget: 40 });
      else if (/\bramp\b/i.test(last)) {
        text = JSON.stringify({ reply: '', prob: { turn: 3, needs: { terre: 3 }, mulligans: 1, keep: { ramp: 1 } } });
      } else if (/due mulligan/i.test(last)) {
        // #791: mulligan detti senza la mano da tenere.
        text = JSON.stringify({ reply: '', prob: { turn: 3, needs: { terre: 3 }, mulligans: 2 } });
      } else if (/mulligan/i.test(last)) {
        // #791: «in 1 contro 1 andando per secondo, con un mulligan se ho meno di 2 terre».
        text = JSON.stringify({ reply: '', prob: { turn: 3, needs: { terre: 3 }, game: 'draw', mulligans: 1, keep: { terre: 2 } } });
      } else if (/probabilit/i.test(last)) {
        text = JSON.stringify({ reply: '', prob: { turn: 1, needs: { terre: 1 } } });
      } else text = JSON.stringify({ reply: 'Ok.' });
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    // La chat dei mazzi chiede il reasoning → cammino streaming: delega al
    // mock non-streaming qui sopra.
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text);
      return r;
    };
  });
}

// Mazzo seminato: Bolt (1,50 €), Dragon (0,90 €) e una Mountain (0,10 €).
async function seedDeck(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  const deckId = decodeURIComponent(hash.replace('#/deck/', ''));
  await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    let deck = r.deck;
    for (const cid of ['c-bolt', 'c-dragon', 'c-mountain']) {
      deck = window.SN_DECKS.addCard(deck, cid).deck;
    }
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  }, deckId);
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#deckList .dk-row')).toHaveCount(3);
  return deckId;
}

test('le card statistiche mostrano i numeri giusti: curva, colori, composizione, legalità, budget', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedDeck(page);

  // Stato di riposo: statistiche visibili col corpo popolato.
  await expect(page.locator('#stateStats')).toBeVisible();
  await expect(page.locator('#statsBody')).toBeVisible();

  // Curva di mana (§9.1): Bolt a 1, Dragon a 6; la TERRA non entra in curva.
  await expect(page.locator('.dk-curve-col[data-cmc="1"]')).toHaveAttribute('data-n', '1');
  await expect(page.locator('.dk-curve-col[data-cmc="6"]')).toHaveAttribute('data-n', '1');
  await expect(page.locator('.dk-curve-col[data-cmc="0"]')).toHaveAttribute('data-n', '0');
  // CMC medio sulle non-terre: (1 + 6) / 2 = 3,50.
  await expect(page.locator('#statAvg')).toContainText('3,50');

  // Colori: richiesto R = 3 pip ({R} + {4}{R}{R}), prodotto R = 1 fonte (Mountain).
  const rowR = page.locator('.dk-color-row[data-color="R"]');
  await expect(rowR.locator('.dk-color-n').nth(0)).toHaveText('3');
  await expect(rowR.locator('.dk-color-n').nth(1)).toHaveText('1');

  // Composizione per tipo + totale /100.
  await expect(page.locator('.dk-type-row[data-type="Creature"] .dk-type-n')).toHaveText('1');
  await expect(page.locator('.dk-type-row[data-type="Istantanei"] .dk-type-n')).toHaveText('1');
  await expect(page.locator('.dk-type-row[data-type="Terre"] .dk-type-n')).toHaveText('1');
  await expect(page.locator('#statTotal')).toContainText('3/100');

  // Legalità (§9.1): tutte e tre le righe in verde (singleton/identity/banned).
  for (const check of ['singleton', 'identity', 'banned']) {
    await expect(page.locator(`.dk-leg-row[data-check="${check}"]`)).toHaveAttribute('data-ok', '1');
  }

  // Budget (§9.2) senza tetto: totale 1,50+0,90+0,10 = 2,50 €, niente residuo.
  await expect(page.locator('.dk-budget-row[data-b="total"] .dk-budget-n')).toHaveText('2,50 €');
  await expect(page.locator('.dk-budget-row[data-b="cap"]')).toHaveCount(0);
});

test('il tetto di budget dallo switcher: totale e residuo sempre visibili, sforamento in evidenza', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedDeck(page);

  // Click sul nome del mazzo → switcher → "Budget…" → campo di modifica.
  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Budget…' }).click();
  await page.fill('#deckBudgetEdit', '10');
  await page.press('#deckBudgetEdit', 'Enter');

  // Header e card Budget si aggiornano: tetto 10 €, residuo 10 − 2,50 = 7,50 €.
  await expect(page.locator('#commanderLine')).toContainText('Budget: 10 €');
  await expect(page.locator('.dk-budget-row[data-b="cap"] .dk-budget-n')).toHaveText('10,00 €');
  const residuo = page.locator('.dk-budget-row[data-b="residuo"]');
  await expect(residuo.locator('.dk-budget-n')).toHaveText('7,50 €');
  await expect(residuo).toHaveAttribute('data-over', '0');

  // Tetto sotto il totale → residuo negativo marcato come sforamento.
  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Budget…' }).click();
  await page.fill('#deckBudgetEdit', '2');
  await page.press('#deckBudgetEdit', 'Enter');
  await expect(page.locator('.dk-budget-row[data-b="residuo"]')).toHaveAttribute('data-over', '1');
  await expect(page.locator('.dk-budget-row[data-b="residuo"] .dk-budget-n')).toHaveText('-0,50 €');
});

test('il calcolatore di probabilità nel sotto-pannello: caso deterministico al 100%', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedDeck(page);

  // La categoria implicita "terre" esiste perché il mazzo ha una terra (§9.3).
  const terreInput = page.locator('#probNeeds input[data-tag="terre"]');
  await expect(terreInput).toBeVisible();

  // Turno 1 con 3 carte in libreria: si vede TUTTA la libreria (mano da 7),
  // quindi "1 terre" è certo → il Monte Carlo deve dire esattamente 100%.
  // Feedback #354: la stima si calcola DA SOLA appena si digita, senza bottone.
  await page.fill('#probTurn', '1');
  await terreInput.fill('1');
  await expect(page.locator('#probResult')).toHaveText('≈ 100,0%');

  // Chiedere 2 terre quando in libreria ce n'è UNA sola → impossibile: 0%.
  await terreInput.fill('2');
  await expect(page.locator('#probResult')).toHaveText('≈ 0,0%');
});

// Feedback #353: nel calcolatore di probabilità il campo numerico si gonfiava a
// tutta la riga (colpa della regola generica input→width:100%) schiacciando il
// nome della categoria fino a renderlo illeggibile. Il nome della categoria deve
// avere lo spazio; il numero (max 2 cifre) resta in una casella piccola. Si
// asserisce il layout: etichetta molto più larga del campo, campo piccolo,
// etichetta non troncata anche a colonna larga.
test('il calcolatore di probabilità: la categoria è leggibile, il numero sta in una casella piccola (#353)', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await seedDeck(page);

  // Tagga una carta con un nome di categoria lungo (come nel feedback reale).
  await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    const deck = window.SN_DECKS.addTagToCard(r.deck, 'c-bolt', 'ragionamento');
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  }, deckId);
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#deckList .dk-row')).toHaveCount(3);
  await expect(page.locator('#probNeeds input[data-tag="ragionamento"]')).toBeVisible();

  // Colonna destra larga come quando l'utente la trascina ad allargarsi: è lì
  // che il bug era più evidente (più spazio → il campo si allargava di più).
  await page.evaluate(() => {
    const grid = document.getElementById('builderGrid');
    grid.style.gridTemplateColumns = '340px 6px minmax(0,1fr) 6px 640px';
  });
  await page.waitForTimeout(100);

  const row = page.locator('#probNeeds .dk-prob-row', { has: page.locator('input[data-tag="ragionamento"]') });
  const label = row.locator('label');
  const input = row.locator('input[data-tag]');
  const lb = await label.boundingBox();
  const ib = await input.boundingBox();

  // Il campo numerico è piccolo (2 cifre), non un box a tutta riga.
  expect(ib.width).toBeLessThanOrEqual(70);
  // L'etichetta-categoria prende lo spazio: molto più larga del numero.
  expect(lb.width).toBeGreaterThan(ib.width * 3);
  // Con quella larghezza il nome ci sta tutto: nessun troncamento.
  const clipped = await label.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(clipped).toBe(false);
  await expect(label).toHaveText('ragionamento');
});

// Feedback #354: la probabilità si calcola DA SOLA e continua a raffinarsi (più
// mani simulate) finché non converge, poi si ferma — niente più bottone né
// oscillazione a ogni ricalcolo. Si asserisce il COMPORTAMENTO: per un caso a
// probabilità intermedia (non 0/100) il conteggio delle "mani simulate" cresce
// oltre il primo batch e arriva al tetto, mentre pulsa l'indicatore di
// raffinamento che poi sparisce a convergenza avvenuta.
test('la probabilità si raffina da sola fino al tetto e poi si ferma (#354)', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await seedDeck(page);

  // Mazzo grande a probabilità intermedia: 40 terre su 99 carte. A turno 1
  // (7 carte) la probabilità di 3+ terre è ~25%, ben lontana da 0 e da 100.
  await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    const deck = r.deck;
    deck.carte = [
      { scryfall_id: 'c-mountain', qty: 40 },
      { scryfall_id: 'c-bolt', qty: 30 },
      { scryfall_id: 'c-dragon', qty: 29 },
    ];
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  }, deckId);
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');

  const terreInput = page.locator('#probNeeds input[data-tag="terre"]');
  await expect(terreInput).toBeVisible();
  await page.fill('#probTurn', '1');
  await terreInput.fill('3');

  const result = page.locator('#probResult');
  // Parte subito con una stima (il primo batch appare quasi istantaneo).
  await expect(result).toHaveText(/≈ \d/);
  const first = await result.textContent();
  const firstPct = Number(first.replace(/[^\d,]/g, '').replace(',', '.'));
  expect(firstPct).toBeGreaterThan(1);
  expect(firstPct).toBeLessThan(99); // caso intermedio: davvero un Monte Carlo

  // Mentre converge, l'indicatore di raffinamento è attivo…
  await expect(result).toHaveClass(/dk-prob-refining/);

  // …e le "mani simulate" nel tooltip crescono fino al tetto (≥ 1.000.000),
  // provando che continua a raffinare da solo senza intervento dell'utente.
  const simCount = async () => {
    const t = (await result.getAttribute('title')) || '';
    const m = /^([\d.]+)/.exec(t);
    return m ? Number(m[1].replace(/\./g, '')) : 0;
  };
  await expect.poll(simCount, { timeout: 30_000 }).toBeGreaterThanOrEqual(1000000);

  // Raggiunto il tetto si ferma: l'indicatore di raffinamento sparisce.
  await expect(result).not.toHaveClass(/dk-prob-refining/);

  // Cambiare condizione (il turno) fa ripartire il raffinamento da solo.
  await page.fill('#probTurn', '2');
  await expect(result).toHaveClass(/dk-prob-refining/);
});

test('budget e probabilità via chat: il sistema applica il tetto e risponde con la simulazione', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedDeck(page);

  // "budget 40 euro" in chat (§9.2): il tetto lo applica IL SISTEMA — la
  // conferma è nella bolla e header + card Budget si aggiornano davvero.
  await page.fill('#chatInput', 'budget 40 euro');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last()).toContainText('Budget impostato a 40 €');
  await expect(page.locator('#commanderLine')).toContainText('Budget: 40 €');
  await expect(page.locator('.dk-budget-row[data-b="cap"] .dk-budget-n')).toHaveText('40,00 €');

  // "che probabilità…" in chat (§9.3): la simulazione gira in locale e il
  // risultato (caso certo: 1 terra al turno 1 con 3 carte viste) è nella bolla.
  await page.fill('#chatInput', 'che probabilità ho di avere 1 terra al turno 1?');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last()).toContainText('Probabilità di avere 1 terre al turno 1 (partita a più giocatori): ≈ 100,0%');
});

// ── #791: partita a più giocatori di default, mulligan London, pescate extra ──

function comb(n, k) { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; }
function hyperAtLeast(N, K, n, k) {
  let p = 0;
  for (let x = k; x <= Math.min(K, n); x++) p += (comb(K, x) * comb(N - K, n - x)) / comb(N, n);
  return p;
}

// 40 terre su 99 carte: probabilità intermedie, lontane da 0 e da 100.
async function seedBigDeck(page, deckId) {
  await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    const deck = r.deck;
    deck.carte = [
      { scryfall_id: 'c-mountain', qty: 40 },
      { scryfall_id: 'c-bolt', qty: 30 },
      { scryfall_id: 'c-dragon', qty: 29 },
    ];
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  }, deckId);
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#probNeeds input[data-tag="terre"]')).toBeVisible();
}

const pctOf = (txt) => Number(String(txt).replace(/[^\d,]/g, '').replace(',', '.'));

// Aspetta che la stima smetta di raffinarsi e la legge in punti percentuali.
async function settledPct(page) {
  const result = page.locator('#probResult');
  await expect(result).toHaveText(/≈ \d/);
  await expect(result).not.toHaveClass(/dk-prob-refining/, { timeout: 30_000 });
  return pctOf(await result.textContent());
}

test('il riquadro fa scegliere partita, mulligan e pescate extra, e il numero cambia come in una partita vera (#791)', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedBigDeck(page, await seedDeck(page));

  await page.fill('#probTurn', '1');
  await page.locator('#probNeeds input[data-tag="terre"]').fill('3');

  // Default a più giocatori: al turno 1 si pesca, 8 carte viste.
  await expect(page.locator('#probGame')).toHaveText(/più giocatori/);
  const multi = await settledPct(page);
  expect(Math.abs(multi - hyperAtLeast(99, 40, 8, 3) * 100)).toBeLessThan(0.5);
  await expect(page.locator('#probResult')).toHaveAttribute('title', /8 carte viste/);

  // A due iniziando si salta la pescata: 7 carte, una in meno.
  await page.click('#probGame');
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Partita a due, inizio io' }).click();
  await expect(page.locator('#probGame')).toHaveText(/a due, inizio io/);
  const play = await settledPct(page);
  expect(Math.abs(play - hyperAtLeast(99, 40, 7, 3) * 100)).toBeLessThan(0.5);
  expect(multi).toBeGreaterThan(play + 5);

  // Se inizia l'altro si pesca, come a più giocatori.
  await page.click('#probGame');
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Partita a due, inizia l\'altro' }).click();
  expect(Math.abs((await settledPct(page)) - multi)).toBeLessThan(0.5);

  // Mulligan: compare la colonna «per tenere», già con 2 terre, e la probabilità sale.
  const keepTerre = page.locator('#probNeeds input[data-keep="terre"]');
  await expect(keepTerre).toBeHidden();
  await page.fill('#probMull', '1');
  await expect(keepTerre).toBeVisible();
  await expect(keepTerre).toHaveValue('2');
  const mull = await settledPct(page);
  expect(mull).toBeGreaterThan(multi + 3);
  // Tolto il mulligan si torna al numero di prima, e la colonna sparisce.
  await page.fill('#probMull', '0');
  await expect(keepTerre).toBeHidden();
  expect(Math.abs((await settledPct(page)) - multi)).toBeLessThan(0.5);

  // Pescate extra: due carte in più entro il turno.
  await page.fill('#probExtra', '2');
  await expect(page.locator('#probResult')).toHaveAttribute('title', /10 carte viste/);
  expect(Math.abs((await settledPct(page)) - hyperAtLeast(99, 40, 10, 3) * 100)).toBeLessThan(0.5);
});

test('chat e riquadro danno lo stesso numero alle stesse condizioni (#791)', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedBigDeck(page, await seedDeck(page));

  await page.fill('#chatInput', 'che probabilità ho di avere 3 terre al turno 3 in 1 contro 1 andando per secondo, con un mulligan se ho meno di 2 terre?');
  await page.press('#chatInput', 'Enter');
  const bolla = page.locator('.dk-msg-bot').last();
  await expect(bolla).toContainText('Probabilità di avere 3 terre al turno 3 (partita a due, inizia l\'altro; fino a 1 mulligan se la mano non ha almeno 2 terre): ≈ ');
  const chat = pctOf(/≈ ([\d,]+)%/.exec(await bolla.textContent())[1]);

  await page.fill('#probTurn', '3');
  await page.locator('#probNeeds input[data-tag="terre"]').fill('3');
  await page.click('#probGame');
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Partita a due, inizia l\'altro' }).click();
  await page.fill('#probMull', '1');
  await expect(page.locator('#probNeeds input[data-keep="terre"]')).toHaveValue('2');
  const riquadro = await settledPct(page);
  expect(Math.abs(chat - riquadro)).toBeLessThan(0.6);

  // Una mano da tenere con una categoria che il mazzo non ha non diventa un numero inventato.
  await page.fill('#chatInput', 'e se tengo solo mani con un ramp?');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last()).toContainText('Nel mazzo non c\'è la categoria «ramp»: puoi chiedere terre.');
});

test('in chat un mulligan detto senza la mano da tenere parte da 2 terre, come nel riquadro (#791)', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedBigDeck(page, await seedDeck(page));

  await page.fill('#chatInput', 'che probabilità ho di avere 3 terre al turno 3 con due mulligan?');
  await page.press('#chatInput', 'Enter');
  const bolla = page.locator('.dk-msg-bot').last();
  await expect(bolla).toContainText('Probabilità di avere 3 terre al turno 3 (partita a più giocatori; fino a 2 mulligan se la mano non ha almeno 2 terre): ≈ ');
  const chat = pctOf(/≈ ([\d,]+)%/.exec(await bolla.textContent())[1]);

  await page.fill('#probTurn', '3');
  await page.locator('#probNeeds input[data-tag="terre"]').fill('3');
  await page.fill('#probMull', '2');
  await expect(page.locator('#probNeeds input[data-keep="terre"]')).toHaveValue('2');
  expect(Math.abs(chat - await settledPct(page))).toBeLessThan(0.6);
});

test('il riquadro resta compatto: senza mulligan nessuna colonna in più, con il mulligan le categorie restano leggibili (#791)', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await seedDeck(page);
  await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    let deck = window.SN_DECKS.addTagToCard(r.deck, 'c-bolt', 'rimozione');
    deck = window.SN_DECKS.addTagToCard(deck, 'c-dragon', 'minaccia');
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  }, deckId);
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#probNeeds input[data-tag="minaccia"]')).toBeVisible();

  const card = page.locator('#probCard');
  const rowH = (await page.locator('#probNeeds .dk-prob-row').first().boundingBox()).height;
  // Tre righe in più (partita, mulligan, pescate extra) e niente intestazione di colonna.
  await expect(page.locator('.dk-prob-head')).toBeHidden();
  const before = (await card.boundingBox()).height;
  await page.fill('#probMull', '1');
  await expect(page.locator('.dk-prob-head')).toBeVisible();
  const after = (await card.boundingBox()).height;
  // Con il mulligan cresce solo della riga d'intestazione.
  expect(after - before).toBeLessThanOrEqual(rowH);

  // Le caselle restano piccole e allineate sotto le loro intestazioni; i nomi si leggono.
  for (const tag of ['rimozione', 'minaccia', 'terre']) {
    const row = page.locator('#probNeeds .dk-prob-row', { has: page.locator(`input[data-tag="${tag}"]`) });
    const label = row.locator('label');
    expect(await label.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false);
    expect((await row.locator('input[data-keep]').boundingBox()).width).toBeLessThanOrEqual(70);
  }
  const head = await page.locator('.dk-prob-head .dk-prob-keep').boundingBox();
  const keepBox = await page.locator('#probNeeds input[data-keep="terre"]').boundingBox();
  expect(Math.abs((head.x + head.width) - (keepBox.x + keepBox.width))).toBeLessThan(2);
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: 'tests/.shots/decks-prob-791.png' });

  // Anche col tema scuro, e con la scelta della partita aperta.
  await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE(
    { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } },
    { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }));
  await page.click('#probGame');
  await expect(page.locator('.dk-ctxmenu .sn-select-option')).toHaveCount(3);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/decks-prob-791-scuro.png' });
});
