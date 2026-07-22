// STRESS verifier (temporaneo, non versionato): stressa i cammini limite del
// filtro semantico. NB: il fixture inietta il proprio arg in app.evaluate → la
// risposta del filtro si hardcoda nel testo della funzione (stringa) iniettata.

import { test, expect } from './fixtures/electron.mjs';

async function setup(app, filterMode) {
  const filterBody = {
    empty: "() => JSON.stringify({ keep: [] })",
    garbage: "() => 'non sono json <script>'",
    ok: "() => JSON.stringify({ keep: ['bolt-1'] })",
  }[filterMode];
  await app.evaluate(`(async () => {
    const COMMANDER = { id:'niv-1', name:'Niv-Mizzet, Parun', mana_cost:'{U}{U}{U}{R}{R}{R}', cmc:6, type_line:'Legendary Creature — Dragon Wizard', colors:['U','R'], color_identity:['U','R'], image_uris:{normal:'https://cards.test/niv.jpg', art_crop:'https://cards.test/niv-art.jpg'}, prices:{eur:'3.21'}, legalities:{commander:'legal'}, scryfall_uri:'https://scryfall.com/card/niv' };
    const BOLT = { id:'bolt-1', name:'Lightning Bolt', mana_cost:'{R}', cmc:1, type_line:'Instant', oracle_text:'Lightning Bolt deals 3 damage to any target.', colors:['R'], color_identity:['R'], image_uris:{normal:'https://cards.test/bolt.jpg'}, prices:{eur:'1.10'}, legalities:{commander:'legal'}, scryfall_uri:'https://scryfall.com/card/bolt' };
    const XSS = { id:'xss-1', name:'<img src=x onerror=window.__pwned=1>Zap', mana_cost:'{R}', cmc:1, type_line:'Instant', oracle_text:'Zap deals 1 damage.', colors:['R'], color_identity:['R'], image_uris:{normal:'https://cards.test/zap.jpg'}, prices:{eur:'0.10'}, legalities:{commander:'legal'}, scryfall_uri:'https://scryfall.com/card/zap' };
    const BY_ID = { 'niv-1':COMMANDER, 'bolt-1':BOLT, 'xss-1':XSS };
    globalThis.__scryRequests = [];
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      globalThis.__scryRequests.push(String(url));
      const u = new URL(String(url)); let b = null;
      if (u.pathname === '/cards/search') b = { data:[BOLT, XSS], has_more:false };
      else if (BY_ID[u.pathname.replace('/cards/','')]) b = BY_ID[u.pathname.replace('/cards/','')];
      else if (u.pathname === '/symbology') b = { data:[{symbol:'{U}',svg_uri:'x'},{symbol:'{R}',svg_uri:'x'}] };
      if (!b) return { ok:false, status:404, json:async()=>({}) };
      return { ok:true, status:200, json:async()=>b };
    });
    const C = globalThis.SN_CONST;
    globalThis.__filterCalls = [];
    const filterReply = ${filterBody};
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const last = String(messages[messages.length-1].content || '');
      let text;
      if (/CARTE CANDIDATE/.test(last)) { globalThis.__filterCalls.push(1); text = filterReply(); }
      else if (/mecc-esatta/i.test(last)) text = JSON.stringify({ reply:'Ecco.', query:'t:instant cmc<=1' });
      else if (/danni/i.test(last)) text = JSON.stringify({ reply:'Cerco carte che fanno danni.', query:'(o:damage or o:deals or o:burn)', filter:'infligge danni diretti a una creatura o al giocatore' });
      else text = JSON.stringify({ reply:'Ok.' });
      return { text, model:attempts[0].model, provider:attempts[0].provider, usage:{} };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text); return r;
    };
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels:false, apiKeys:{gemini:'k'}, models:{ [C.ACTIONS.DECKS_CHAT]:'flash-lite-3', [C.ACTIONS.DECKS_SEARCH_FILTER]:'flash-lite-3' }, modelRegistry:C.DEFAULT_MODEL_REGISTRY });
  })()`);
}

async function newDeckWithCommander(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  const id = decodeURIComponent(hash.replace('#/deck/', ''));
  await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    return chrome.runtime.sendMessage({ type: MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1' });
  }, id);
}

async function ask(page, text) {
  await page.fill('#chatInput', text);
  await page.press('#chatInput', 'Enter');
  return page.locator('.dk-msg-bot').last();
}

test('A) filtro svuota tutto → fallback ai risultati larghi (niente schermo vuoto)', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await setup(app, 'empty');
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeckWithCommander(page);
  const bubble = await ask(page, 'carte che fanno danni');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(2);
  expect(await app.evaluate('globalThis.__filterCalls.length')).toBe(1);
});

test('B) giudice risponde spazzatura → fallback ai risultati larghi', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await setup(app, 'garbage');
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeckWithCommander(page);
  const bubble = await ask(page, 'carte che fanno danni');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(2);
});

test('C) ricerca meccanica (no filter) → il giudice NON viene chiamato', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await setup(app, 'ok');
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeckWithCommander(page);
  const bubble = await ask(page, 'istantanei mecc-esatta a 1 mana');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(2);
  expect(await app.evaluate('globalThis.__filterCalls.length')).toBe(0);
});

test('D) nome carta con <script>/<img> reso escaped, niente esecuzione', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await setup(app, 'empty'); // fallback → mostra anche la carta col nome XSS
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeckWithCommander(page);
  const bubble = await ask(page, 'carte che fanno danni');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(2);
  await expect(bubble.locator('.dk-row-name').last()).toContainText('<img src=x');
  expect(await page.evaluate(() => window.__pwned || false)).toBe(false);
});
