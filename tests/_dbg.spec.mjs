import { test, expect } from './fixtures/electron.mjs';
test('dbg empty', async ({ app, openTab }) => {
  test.setTimeout(60000);
  await app.evaluate((mode) => {
    const COMMANDER = { id:'niv-1', name:'Niv-Mizzet, Parun', mana_cost:'{U}{U}{U}{R}{R}{R}', cmc:6, type_line:'Legendary Creature — Dragon Wizard', colors:['U','R'], color_identity:['U','R'], image_uris:{normal:'https://cards.test/niv.jpg', art_crop:'https://cards.test/niv-art.jpg'}, prices:{eur:'3.21'}, legalities:{commander:'legal'}, scryfall_uri:'https://scryfall.com/card/niv' };
    const BOLT = { id:'bolt-1', name:'Lightning Bolt', mana_cost:'{R}', cmc:1, type_line:'Instant', oracle_text:'Lightning Bolt deals 3 damage to any target.', colors:['R'], color_identity:['R'], image_uris:{normal:'https://cards.test/bolt.jpg'}, prices:{eur:'1.10'}, legalities:{commander:'legal'}, scryfall_uri:'https://scryfall.com/card/bolt' };
    const CR = { id:'xss-1', name:'<img src=x onerror=window.__pwned=1>Zap', mana_cost:'{R}', cmc:1, type_line:'Instant', oracle_text:'Zap deals 1 damage.', colors:['R'], color_identity:['R'], image_uris:{normal:'x'}, prices:{eur:'0.10'}, legalities:{commander:'legal'}, scryfall_uri:'x' };
    const BY_ID={'niv-1':COMMANDER,'bolt-1':BOLT,'xss-1':CR};
    globalThis.SN_SCRYFALL._setFetch(async (url)=>{const u=new URL(String(url));let b=null;if(u.pathname==='/cards/search')b={data:[BOLT,CR],has_more:false};else if(BY_ID[u.pathname.replace('/cards/','')])b=BY_ID[u.pathname.replace('/cards/','')];else if(u.pathname==='/symbology')b={data:[{symbol:'{U}',svg_uri:'x'},{symbol:'{R}',svg_uri:'x'},{symbol:'{2}',svg_uri:'x'}]};if(!b)return{ok:false,status:404,json:async()=>({})};return{ok:true,status:200,json:async()=>b};});
    const C=globalThis.SN_CONST;
    globalThis.SN_PROVIDERS.completeWithFallback=async({attempts,messages})=>{const last=String(messages[messages.length-1].content||'');let text;if(/CARTE CANDIDATE/.test(last)){text=JSON.stringify({keep:[]});}else if(/danni/i.test(last)){text=JSON.stringify({reply:'x',query:'(o:damage or o:deals or o:burn)',filter:'infligge danni diretti a una creatura o al giocatore'});}else{text=JSON.stringify({reply:'Ok.'});}return{text,model:attempts[0].model,provider:attempts[0].provider,usage:{}};};
    globalThis.SN_PROVIDERS.streamCompleteWithFallback=async({attempts,messages,onDelta})=>{const r=await globalThis.SN_PROVIDERS.completeWithFallback({attempts,messages});if(onDelta)onDelta(r.text);return r;};
    return globalThis.SN_STORAGE.updateSettings({useDefaultModels:false,apiKeys:{gemini:'k'},models:{[C.ACTIONS.DECKS_CHAT]:'flash-lite-3',[C.ACTIONS.DECKS_SEARCH_FILTER]:'flash-lite-3'},modelRegistry:C.DEFAULT_MODEL_REGISTRY});
  },'empty');
  const page=await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const hash=await page.evaluate(()=>location.hash);
  const id=decodeURIComponent(hash.replace('#/deck/',''));
  await page.evaluate(async(id)=>{const{MSG}=window.SN_MSG;return chrome.runtime.sendMessage({type:MSG.DECKS_SET_COMMANDER,id,scryfallId:'niv-1'});},id);
  await page.fill('#chatInput','carte che fanno danni');
  await page.press('#chatInput','Enter');
  await page.waitForTimeout(3000);
  const html=await page.locator('.dk-msg-bot').last().innerHTML();
  console.log('BUBBLE:',html.slice(0,1500));
});
