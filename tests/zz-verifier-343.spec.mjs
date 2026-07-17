// Verifica black-box del feedback #343 (verifier): nel builder dei mazzi, i
// nomi carta citati nel TESTO LIBERO di una risposta (senza elenco risultati)
// devono aprire un carosello navigabile con le frecce su TUTTE le carte citate
// nel messaggio, e la carta attualmente mostrata deve essere EVIDENZIATA nel
// testo (senza la sottolineatura standard). Scritto dal sintomo utente, non
// dal diff. Scryfall e provider mockati: nessuna rete.

import { test, expect } from './fixtures/electron.mjs';

const CARDS = {
  'c-bolt': {
    id: 'c-bolt', name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1,
    type_line: 'Instant', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/bolt.jpg', art_crop: 'https://cards.test/bolt-art.jpg' },
    prices: { eur: '1.50' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/bolt',
  },
  'c-dragon': {
    id: 'c-dragon', name: 'Shivan Dragon', mana_cost: '{4}{R}{R}', cmc: 6,
    type_line: 'Legendary Creature — Dragon', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/dragon.jpg', art_crop: 'https://cards.test/dragon-art.jpg' },
    prices: { eur: '0.90' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/dragon',
  },
  'c-goblin': {
    id: 'c-goblin', name: 'Goblin Guide', mana_cost: '{R}', cmc: 1,
    type_line: 'Creature — Goblin Scout', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/goblin.jpg', art_crop: 'https://cards.test/goblin-art.jpg' },
    prices: { eur: '2.10' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/goblin',
  },
};

async function mockScryfall(app) {
  await app.evaluate((electron, cardsJson) => {
    const CARDS = JSON.parse(cardsJson);
    const byName = {};
    for (const c of Object.values(CARDS)) byName[c.name.toLowerCase()] = c;
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      const m = /^\/cards\/([^/]+)$/.exec(u.pathname);
      if (u.pathname === '/cards/named') {
        const q = (u.searchParams.get('fuzzy') || u.searchParams.get('exact') || '').toLowerCase();
        body = byName[q] || null;
      } else if (m && CARDS[m[1]]) body = CARDS[m[1]];
      else if (u.pathname === '/cards/search') {
        body = { data: [CARDS['c-dragon'], CARDS['c-goblin']], has_more: false };
      } else if (u.pathname === '/symbology') {
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

// Provider finto: risposta di SOLO testo libero (nessuna query → nessun elenco
// risultati), con tre nomi carta citati in prosa. È esattamente lo scenario
// dello screenshot del feedback.
async function mockProvider(app, replyText) {
  await app.evaluate(async (electron, reply) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ reply }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text);
      return r;
    };
  }, replyText);
}

async function newDeck(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
}

async function ask(page, text) {
  await page.fill('#chatInput', text);
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble.locator('.dk-msg-text')).toBeVisible();
  return bubble;
}

// Stili calcolati di uno span in prosa: per giudicare l'evidenza in termini
// VISIVI (sfondo + niente sottolineatura), non solo per classe CSS.
async function proseStyle(locator) {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { deco: cs.textDecorationLine, bg: cs.backgroundColor };
  });
}

test('testo libero: click su un nome citato apre il carosello su TUTTE le carte del messaggio, frecce funzionanti, evidenza sulla carta corrente', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app,
    'Ti consiglio [[Lightning Bolt]], [[Shivan Dragon]] e [[Goblin Guide]] per chiudere la partita.');
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);

  const bubble = await ask(page, 'quali carte rosse mi consigli?');
  const spans = bubble.locator('.dk-prose-card');
  await expect(spans).toHaveCount(3);

  // Click DIRETTO (senza hover preventivo) sul secondo nome: il carosello deve
  // aprirsi comunque — l'utente non è tenuto a "caricare" il nome col mouse.
  await spans.nth(1).click();
  await expect(page.locator('#stateCarousel')).toBeVisible();
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/dragon.jpg', { timeout: 10_000 });

  // Il "tasto evidenziato" del feedback: l'indicatore deve dire N su 3 (non 1/1)
  // e le frecce devono sfogliare le altre carte citate nel testo.
  await expect(page.locator('#carouselPos')).toHaveText('2/3');

  // Evidenza sulla carta corrente: sfondo presente e sottolineatura rimossa;
  // gli ALTRI nomi restano sottolineati (sono ancora interattivi).
  const curStyle = await proseStyle(spans.nth(1));
  expect(curStyle.deco, 'la carta mostrata non deve essere sottolineata').not.toContain('underline');
  expect(curStyle.bg, 'la carta mostrata deve avere uno sfondo di evidenza')
    .not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\)|transparent/);
  const otherStyle = await proseStyle(spans.nth(0));
  expect(otherStyle.deco).toContain('underline');

  // Freccia avanti → terza carta; l'evidenza SEGUE la carta mostrata.
  await page.click('#carouselNext');
  await expect(page.locator('#carouselPos')).toHaveText('3/3');
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/goblin.jpg');
  const s3 = await proseStyle(spans.nth(2));
  expect(s3.deco).not.toContain('underline');
  const s2after = await proseStyle(spans.nth(1));
  expect(s2after.deco).toContain('underline');

  // Bordo destro: da 3/3 "avanti" non deve rompere nulla.
  await page.click('#carouselNext');
  await expect(page.locator('#carouselPos')).toHaveText('3/3');

  // Frecce indietro fino al bordo sinistro.
  await page.click('#carouselPrev');
  await page.click('#carouselPrev');
  await expect(page.locator('#carouselPos')).toHaveText('1/3');
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/bolt.jpg');
  await page.click('#carouselPrev');
  await expect(page.locator('#carouselPos')).toHaveText('1/3');

  // Triage vero: Invio aggiunge la carta mostrata al mazzo (successo, non
  // assenza d'errore: la riga compare nella colonna centrale).
  await page.keyboard.press('Enter');
  await expect(page.locator('#deckList .dk-row[data-card-id="c-bolt"]')).toBeVisible();

  // Screenshot come traccia ispezionabile della run.
  await page.screenshot({ path: 'tests/.shots/verifier-343-carousel.png', fullPage: true });

  // Esc chiude e l'evidenza sparisce da TUTTI i nomi (torna la sottolineatura).
  await page.keyboard.press('Escape');
  await expect(page.locator('#stateCarousel')).toBeHidden();
  for (const i of [0, 1, 2]) {
    const s = await proseStyle(spans.nth(i));
    expect(s.deco).toContain('underline');
  }
});

test('stress: mention singola, nome irrisolvibile, doppio click rapido, testo lungo', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  // 10k caratteri di prosa + un nome irrisolvibile + due risolvibili.
  const filler = 'parole '.repeat(1500);
  await mockProvider(app,
    `${filler} Considera [[Carta Inesistente Xyz]], poi [[Lightning Bolt]] e [[Shivan Dragon]].`);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);

  const bubble = await ask(page, 'consigli?');
  const spans = bubble.locator('.dk-prose-card');
  await expect(spans).toHaveCount(3);

  // Doppio click rapido sul nome risolvibile: il carosello si apre una volta
  // sola, senza errori, e le frecce sfogliano le carte RISOLTE del messaggio.
  await spans.nth(1).click();
  await spans.nth(1).click();
  await expect(page.locator('#stateCarousel')).toBeVisible();
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/bolt.jpg', { timeout: 10_000 });
  const pos = await page.locator('#carouselPos').textContent();
  // Non impongo COME viene contata la carta irrisolvibile, ma le due risolte
  // devono esserci entrambe: dalla prima si arriva alla seconda con la freccia.
  await page.click('#carouselNext');
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/dragon.jpg');

  await page.keyboard.press('Escape');
  await expect(page.locator('#stateCarousel')).toBeHidden();

  // Click sul nome IRRISOLVIBILE: qualunque sia la scelta (no-op o carosello
  // delle altre), la pagina non deve rompersi e i nomi risolvibili devono
  // continuare a funzionare.
  await spans.nth(0).click();
  await page.waitForTimeout(500);
  await spans.nth(2).click();
  await expect(page.locator('#stateCarousel')).toBeVisible();
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/dragon.jpg', { timeout: 10_000 });
  expect(pos).toBeTruthy();
});

test('sicurezza: HTML ostile nella prosa e nei nomi carta non si esegue', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app,
    'Occhio <script>window.__xss1=1</script> a [[<img src=x onerror="window.__xss2=1">]] e [[Lightning Bolt]] <b>ciao</b>.');
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);

  const bubble = await ask(page, 'test');
  // Il testo ostile è visibile come TESTO, non eseguito né interpretato.
  await expect(bubble.locator('.dk-msg-text')).toContainText('<b>ciao</b>');
  const xss = await page.evaluate(() => [window.__xss1, window.__xss2]);
  expect(xss).toEqual([undefined, undefined]);
  const scripts = await bubble.locator('.dk-msg-text script, .dk-msg-text img').count();
  expect(scripts).toBe(0);

  // Il nome legittimo continua a funzionare anche in mezzo al testo ostile.
  const bolt = bubble.locator('.dk-prose-card', { hasText: 'Lightning Bolt' });
  await bolt.click();
  await expect(page.locator('#stateCarousel')).toBeVisible();
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/bolt.jpg', { timeout: 10_000 });
});
