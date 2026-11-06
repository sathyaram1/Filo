// #1974 — il motore delle regole di YouTube su una finestra finta: cosa tolgono json-prune e le sue varianti, come set
// aggancia la variabile che la pagina scrive, il JSONPath delle richieste in uscita, il passo dei timer.
// Il mondo vero della pagina, coi frame e il preload, lo prova tests/youtube-blocco.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { motore, sorgente } = require('../../src/preload/youtube-scriptlet.js');

const risposta = () => ({ videoDetails: { videoId: 'v1' }, adPlacements: [{ a: 1 }], adSlots: [{ s: 1 }], playerAds: [{ p: 1 }] });

function finestra(extra = {}) {
  const W = {
    JSON: { parse: JSON.parse, stringify: JSON.stringify }, Response, Request, ReferenceError,
    setTimeout: (fn, ms) => ({ fn, ms }),
    fetch: async (u) => new Response(JSON.stringify(risposta()), { status: 203, statusText: 'Fatto', headers: { 'x-prova': 'si' } }),
    ...extra,
  };
  return W;
}

test('set: la variabile che la pagina scrive dopo nasce già senza le pubblicità', () => {
  const W = finestra();
  motore([
    ['set', 'ytInitialPlayerResponse.adPlacements', 'undefined'],
    ['set', 'ytInitialPlayerResponse.playerAds', 'undefined'],
    ['set', 'ytInitialPlayerResponse.adSlots', 'undefined'],
  ], W, false);
  W.ytInitialPlayerResponse = risposta();
  assert.equal(W.ytInitialPlayerResponse.adPlacements, undefined);
  assert.equal(W.ytInitialPlayerResponse.playerAds, undefined, 'la seconda regola sulla stessa radice regge');
  assert.equal(W.ytInitialPlayerResponse.adSlots, undefined, 'e anche la terza');
  assert.equal(W.ytInitialPlayerResponse.videoDetails.videoId, 'v1');
  W.ytInitialPlayerResponse = risposta();
  assert.equal(W.ytInitialPlayerResponse.adPlacements, undefined, 'una seconda pagina nella stessa scheda è agganciata uguale');
  W.ytInitialPlayerResponse.adPlacements = [1];
  assert.equal(W.ytInitialPlayerResponse.adPlacements, undefined, 'la pagina non la rimette');
});

test('set: valori noti e un valore sconosciuto che non fa niente', () => {
  const { valoreSet } = motore([], finestra(), true);
  assert.deepEqual(valoreSet('false'), { v: false });
  assert.deepEqual(valoreSet('emptyArr'), { v: [] });
  assert.deepEqual(valoreSet('17'), { v: 17 });
  assert.equal(valoreSet('codice()'), null);
  assert.deepEqual(valoreSet('{"a":1}', true), { v: { a: 1 } });
});

test('json-prune: JSON.parse e Response.json escono senza le pubblicità; «[-]» toglie l\'elemento intero', async () => {
  const W = finestra();
  motore([
    ['json-prune', 'playerResponse.adPlacements adPlacements adSlots'],
    ['json-prune', 'entries.[-].command.isAd'],
  ], W, false);
  const o = W.JSON.parse(JSON.stringify({ ...risposta(), playerResponse: risposta() }));
  assert.equal(o.adPlacements, undefined);
  assert.equal(o.adSlots, undefined);
  assert.equal(o.playerResponse.adPlacements, undefined);
  assert.deepEqual(o.playerAds, [{ p: 1 }], 'quello che la regola non nomina resta');
  const e = W.JSON.parse('{"entries":[{"command":{"isAd":true}},{"command":{"video":1}}]}');
  assert.deepEqual(e.entries, [{ command: { video: 1 } }]);
  const r = await new W.Response(JSON.stringify(risposta())).json();
  assert.equal(r.adPlacements, undefined);
});

test('json-prune: con i percorsi richiesti pota solo gli oggetti che li hanno', () => {
  const W = finestra();
  motore([['json-prune', 'adPlacements', 'videoDetails']], W, false);
  assert.equal(W.JSON.parse('{"videoDetails":{},"adPlacements":[1]}').adPlacements, undefined);
  assert.deepEqual(W.JSON.parse('{"adPlacements":[1]}').adPlacements, [1]);
});

test('json-prune-fetch-response: pota solo la risposta della richiesta indicata, il resto della risposta resta com\'era', async () => {
  const W = finestra();
  motore([['json-prune-fetch-response', 'adPlacements adSlots', '', 'propsToMatch', '/\\/player(\\?|$)/']], W, false);
  const r = await W.fetch('https://www.youtube.com/youtubei/v1/player?key=1', { method: 'POST' });
  const o = await r.json();
  assert.equal(o.adPlacements, undefined);
  assert.equal(o.adSlots, undefined);
  assert.deepEqual(o.playerAds, [{ p: 1 }]);
  assert.equal(r.status, 203);
  assert.equal(r.headers.get('x-prova'), 'si');
  const altro = await (await W.fetch('https://www.youtube.com/youtubei/v1/next')).json();
  assert.deepEqual(altro.adPlacements, [{ a: 1 }], 'una richiesta che non corrisponde non si tocca');
});

test('json-prune-fetch-response: «url:» e un testo senza barre cercano l\'indirizzo così com\'è', async () => {
  const W = finestra();
  motore([['json-prune-fetch-response', 'adPlacements', '', 'propsToMatch', 'url:/reel_watch?']], W, false);
  assert.equal((await (await W.fetch('https://y/youtubei/v1/reel/reel_watch?x')).json()).adPlacements, undefined);
  assert.ok((await (await W.fetch('https://y/youtubei/v1/reel/reel_watchx')).json()).adPlacements);
});

test('trusted-rpfr: un testo fra virgolette si sostituisce dappertutto, una regola senza flag una volta', async () => {
  const W = finestra({ fetch: async () => new Response('{"adPlacements":1,"x":{"adPlacements":2}}') });
  motore([['trusted-rpfr', '"adPlacements"', '"no_ads"', 'player?']], W, false);
  assert.equal(await (await W.fetch('https://y/youtubei/v1/player?a')).text(), '{"no_ads":1,"x":{"no_ads":2}}');
  assert.equal(await (await W.fetch('https://y/youtubei/v1/next')).text(), '{"adPlacements":1,"x":{"adPlacements":2}}');
  const W2 = finestra({ fetch: async () => new Response('a1 a2') });
  motore([['trusted-rpfr', '/a(\\d)/', 'b$1', '']], W2, false);
  assert.equal(await (await W2.fetch('https://y/qualunque')).text(), 'b1 a2');
});

test('json-prune-xhr-response e trusted-replace-xhr-response: la risposta completa esce cambiata, anche passando per responseText', () => {
  class Base {
    open(method, url) { this.url = url; this.readyState = 1; }
    send() { this.readyState = 4; }
    get response() { return this.readyState === 4 ? JSON.stringify(risposta()) : ''; }
    get responseText() { return this.response; }
  }
  Base.prototype.responseType = '';
  const W = finestra({ XMLHttpRequest: Base });
  motore([
    ['json-prune-xhr-response', 'adPlacements', '', 'propsToMatch', '/\\/player(?:\\?.+)?$/'],
    ['trusted-replace-xhr-response', '"adSlots"', '"no_ads"', '/player'],
  ], W, false);
  const x = new W.XMLHttpRequest();
  x.open('POST', 'https://www.youtube.com/youtubei/v1/player?k=1');
  assert.equal(x.response, '', 'prima della fine non si tocca niente');
  x.send();
  const o = JSON.parse(x.responseText);
  assert.equal(o.adPlacements, undefined);
  assert.equal(o.adSlots, undefined);
  assert.deepEqual(o.no_ads, [{ s: 1 }]);
  const y = new W.XMLHttpRequest();
  y.open('GET', 'https://www.youtube.com/youtubei/v1/next');
  y.send();
  assert.ok(JSON.parse(y.response).adPlacements, 'un\'altra richiesta resta com\'era');
});

test('trusted-edit-inbound-object: la richiesta in uscita cambia solo se i filtri la riconoscono, e l\'oggetto della pagina no', () => {
  const W = finestra();
  motore([
    ['trusted-edit-inbound-object', 'JSON.stringify', '0', '[?.attestationRequest][?.context.client.userAgent*="channel"].context.client[?.clientName=="WEB"]+={"clientScreen":"CHANNEL"}'],
    ['trusted-edit-inbound-object', 'JSON.stringify', '0', '[?.attestationRequest][?.context.client.userAgent=/chan|inline/].playback.ctx.ms="${now}"'],
    ['trusted-edit-inbound-object', 'JSON.stringify', '0', '[?.attestationRequest].playback.ctx.referer=repl({"regex":"(?:#ricarica)?$","replacement":"#ricarica"})'],
    ['trusted-edit-inbound-object', 'JSON.stringify', '0', '[?.commento].context.client.userAgent=repl({"regex":"/; (channel|inline)\\\\b/","replacement":""})'],
  ], W, false);
  const req = { context: { client: { clientName: 'WEB', userAgent: 'Mozilla/5.0 (X11; channel)' } }, attestationRequest: {}, playback: { ctx: { referer: 'https://y/' } } };
  const fuori = JSON.parse(W.JSON.stringify(req));
  assert.equal(fuori.context.client.clientScreen, 'CHANNEL');
  assert.match(fuori.playback.ctx.ms, /^\d{12,}$/);
  assert.equal(fuori.playback.ctx.referer, 'https://y/#ricarica');
  assert.equal(req.context.client.clientScreen, undefined, 'l\'oggetto della pagina resta com\'era');
  const altro = { context: { client: { clientName: 'MWEB', userAgent: 'x; channel' } }, attestationRequest: {}, playback: { ctx: {} } };
  assert.equal(JSON.parse(W.JSON.stringify(altro)).context.client.clientScreen, undefined, '[?.clientName=="WEB"] non passa');
  const senza = { context: { client: { clientName: 'WEB', userAgent: 'x; channel' } } };
  assert.equal(W.JSON.stringify(senza), JSON.stringify(senza), 'senza attestationRequest niente cambia');
  const commento = { commento: 1, context: { client: { userAgent: 'Mozilla/5.0 (X11; inline) y' } } };
  assert.equal(JSON.parse(W.JSON.stringify(commento)).context.client.userAgent, 'Mozilla/5.0 (X11) y');
  assert.equal(W.JSON.stringify('testo'), '"testo"');
});

test('json-edit-fetch-response: «..» cerca a ogni profondità e senza assegnazione toglie gli elementi filtrati', async () => {
  const corpo = { a: { itemSectionRenderer: { contents: [{ video: 1 }, { adSlotRenderer: {} }, { video: 2 }] } } };
  const W = finestra({ fetch: async () => new Response(JSON.stringify(corpo)) });
  motore([['json-edit-fetch-response', '..itemSectionRenderer.contents.*[?.adSlotRenderer]', 'propsToMatch', '/get_watch']], W, false);
  const o = await (await W.fetch('https://m.youtube.com/youtubei/v1/get_watch?x')).json();
  assert.deepEqual(o.a.itemSectionRenderer.contents, [{ video: 1 }, { video: 2 }]);
});

test('nano-stb accorcia solo i timer indicati; nostif ne svuota la funzione', () => {
  const W = finestra();
  motore([['nano-stb', '[native code]', '17000', '0.001'], ['nostif', 'vietato', '']], W, false);
  const nativa = Math.max.bind(null);
  assert.equal(W.setTimeout(nativa, 17000).ms, 17);
  assert.equal(W.setTimeout(nativa, 500).ms, 500);
  assert.equal(W.setTimeout(() => 1, 17000).ms, 17000, 'una funzione scritta dalla pagina non è [native code]');
  const t = W.setTimeout(function vietato() { return 1; }, 10);
  assert.equal(t.fn(), undefined);
});

test('aopr: leggere la proprietà indicata interrompe lo script', () => {
  const W = finestra();
  motore([['aopr', 'spia.dati']], W, false);
  W.spia = { dati: 1 };
  assert.throws(() => W.spia.dati);
});

test('uno scriptlet che fallisce non ferma gli altri; uno sconosciuto si salta', () => {
  const W = finestra();
  const fatte = motore([['trusted-edit-inbound-object', 'Inesistente.metodo', '0', '.a=1'], ['sconosciuto', 'x'], ['set', 'ok.a', 'false']], W, false);
  assert.equal(fatte, 2);
  W.ok = { a: true };
  assert.equal(W.ok.a, false);
});

test('il testo per la pagina: vuoto senza regole, altrimenti una chiamata sola al motore', () => {
  assert.equal(sorgente([]), '');
  const src = sorgente([['set', 'a.b', 'false']]);
  assert.match(src, /^\(function motore\(/);
  const W = finestra();
  new Function('window', src)(W);
  W.a = { b: true };
  assert.equal(W.a.b, false);
});
