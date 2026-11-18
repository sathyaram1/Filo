// #1977 — la trascrizione di un video di YouTube: quale traccia, in che forma arriva al modello, cosa si dice quando
// non c'è, e il taglio dichiarato di una lunghissima. La lettura della pagina dalla rete la porta in testa al testo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = require(join(ROOT, 'src', 'main', 'services', 'trascrizioneYoutube.js'));
const PR = require(join(ROOT, 'src', 'main', 'services', 'pageRead.js'));
const { safeFetch } = require(join(ROOT, 'src', 'main', 'services', 'safe-fetch.js'));

const lettore = (tracce, extra = {}) => ({
  playabilityStatus: { status: 'OK' },
  captions: tracce ? { playerCaptionsTracklistRenderer: { captionTracks: tracce } } : undefined,
  ...extra,
});
const pagina = (r, coda = '') => `<html><head><title>Video - YouTube</title></head><body><script>var ytInitialPlayerResponse = `
  + `${JSON.stringify(r)};var meta = {"a":"};"};</script>${coda}<p>Descrizione del video</p></body></html>`;
const json3 = (eventi) => JSON.stringify({ events: eventi.map(([ms, t]) => ({ tStartMs: ms, segs: [{ utf8: t }] })) });

// La rete finta per `prendi`: un indirizzo → risposta; tiene il conto delle richieste.
function rete(mappa) {
  const viste = [];
  const scarica = async (url, o = {}) => {
    viste.push({ url, metodo: o.metodo || 'GET', corpo: o.corpo || '' });
    for (const [pezzo, r] of mappa) if (url.includes(pezzo)) return typeof r === 'function' ? r(url, o) : { ok: true, stato: 200, testo: r };
    return { ok: false, stato: 404, testo: '' };
  };
  return { scarica, viste };
}

test('l\'id del video si legge da watch, shorts, live e youtu.be; il resto di YouTube non è un video', () => {
  assert.equal(T.idVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'), 'dQw4w9WgXcQ');
  assert.equal(T.idVideo('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(T.idVideo('https://www.youtube.com:4431/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(T.idVideo('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(T.idVideo('https://youtu.be/dQw4w9WgXcQ?si=x'), 'dQw4w9WgXcQ');
  assert.equal(T.idVideo('https://www.youtube.com/'), '');
  assert.equal(T.idVideo('https://www.youtube.com/watch?v=corto'), '');
  assert.equal(T.idVideo('https://www.youtube.com.example/watch?v=dQw4w9WgXcQ'), '');
  assert.equal(T.idVideo('https://vimeo.com/watch?v=dQw4w9WgXcQ'), '');
});

test('il JSON del lettore si estrae intero anche con «};» dentro una stringa', () => {
  const r = lettore([], { videoDetails: { shortDescription: 'trucco: }; var x = {' } });
  assert.deepEqual(T.estraiJson(pagina(r), 'ytInitialPlayerResponse'), r);
});

test('la traccia è quella della lingua del video: a mano se c\'è, se no quella automatica', () => {
  const asrIt = { baseUrl: '/t?a', languageCode: 'it', kind: 'asr' };
  const manEn = { baseUrl: '/t?b', languageCode: 'en' };
  const manIt = { baseUrl: '/t?c', languageCode: 'it-IT' };
  assert.equal(T.scegliTraccia({ captionTracks: [manEn, asrIt] }), asrIt);
  assert.equal(T.scegliTraccia({ captionTracks: [manEn, asrIt, manIt] }), manIt);
  assert.equal(T.scegliTraccia({ captionTracks: [manEn, manIt], audioTracks: [{ defaultCaptionTrackIndex: 1 }] }), manIt);
  assert.equal(T.scegliTraccia({ captionTracks: [] }), null);
});

test('un video coi sottotitoli: righe coi tempi, lingua e tipo dichiarati, json3 chiesto alla traccia', async () => {
  const r = lettore([{ baseUrl: '/api/timedtext?v=abc&lang=it&kind=asr', languageCode: 'it', kind: 'asr' }]);
  const { scarica, viste } = rete([
    ['/watch?v=abcdefghijk', pagina(r)],
    ['/api/timedtext', json3([[0, 'ciao a tutti'], [2500, 'oggi il pane'], [65000, 'con la biga'], [3725000, 'saluti finali']])],
  ]);
  const e = await T.prendi(scarica, 'abcdefghijk');
  assert.equal(e.stato, 'ok');
  assert.equal(e.automatica, true);
  assert.equal(e.lingua, 'italiano');
  assert.equal(e.testo, '[0:00] ciao a tutti oggi il pane\n[1:05] con la biga\n[1:02:05] saluti finali');
  assert.ok(viste[1].url.startsWith('https://www.youtube.com/api/timedtext?') && viste[1].url.includes('fmt=json3'));
  assert.match(T.notaPerModello(e), /sottotitoli generati da YouTube/);
});

test('se la traccia torna vuota si chiede il pannello «Mostra trascrizione», come fa YouTube', async () => {
  const r = lettore([{ baseUrl: '/api/timedtext?v=abc&lang=en', languageCode: 'en' }]);
  const coda = '<script>ytcfg.set({"INNERTUBE_API_KEY":"KEY123","INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"2.2"}}});'
    + 'var ytInitialData = {"x":{"getTranscriptEndpoint":{"params":"PARAMS=="}}};</script>';
  const pannello = { actions: [{ updateEngagementPanelAction: { content: { transcriptRenderer: { body: { initialSegments: [
    { transcriptSegmentRenderer: { startMs: '1000', snippet: { runs: [{ text: 'hello ' }, { text: 'world' }] } } },
    { transcriptSegmentRenderer: { startMs: '30000', snippet: { simpleText: 'second line' } } },
  ] } } } } }] };
  const { scarica, viste } = rete([
    ['/watch?v=', pagina(r, coda)],
    ['/api/timedtext', ''],
    ['/youtubei/v1/get_transcript', JSON.stringify(pannello)],
  ]);
  const e = await T.prendi(scarica, 'abcdefghijk');
  assert.equal(e.stato, 'ok');
  assert.equal(e.testo, '[0:01] hello world\n[0:30] second line');
  const post = viste.find((v) => v.url.includes('get_transcript'));
  assert.equal(post.metodo, 'POST');
  assert.ok(post.url.includes('key=KEY123'));
  assert.deepEqual(JSON.parse(post.corpo), { context: { client: { clientName: 'WEB', clientVersion: '2.2' } }, params: 'PARAMS==' });
});

test('anche l\'XML delle tracce si legge, con le entità', () => {
  const s = T.segmentiDaTraccia('<transcript><text start="1.5" dur="2">l&#39;ora &amp; il tempo</text><text start="3">poi</text></transcript>');
  assert.deepEqual(s, [{ ms: 1500, t: 'l\'ora & il tempo' }, { ms: 3000, t: 'poi' }]);
});

test('senza sottotitoli lo si dice al modello; un video che non si guarda è un errore, non «senza trascrizione»', async () => {
  const assente = await T.prendi(rete([['/watch', pagina(lettore(null))]]).scarica, 'abcdefghijk');
  assert.deepEqual(assente, { stato: 'assente' });
  assert.match(T.notaPerModello(assente), /non ha trascrizione/);
  assert.match(T.notaPerModello(assente), /non rispondere come se l'avessi ascoltato/);
  const chiuso = await T.prendi(rete([['/watch', pagina(lettore(null, { playabilityStatus: { status: 'LOGIN_REQUIRED' } }))]]).scarica, 'abcdefghijk');
  assert.equal(chiuso.stato, 'errore');
  const giu = await T.prendi(rete([]).scarica, 'abcdefghijk');
  assert.equal(giu.stato, 'errore');
  assert.match(T.notaPerModello(giu), /non è riuscito a leggerne la trascrizione/);
});

test('una trascrizione oltre il tetto tiene testa e coda e dice cosa manca, coi tempi', () => {
  const righe = Array.from({ length: 2000 }, (_v, i) => ({ ms: i * 20000, testo: `frase numero ${i} `.padEnd(150, 'x') }));
  const { testo, salto } = T.componi(righe, 60000);
  assert.ok(testo.length <= 60000 + 200);
  assert.ok(testo.startsWith('[0:00] frase numero 0 '));
  assert.ok(testo.includes('frase numero 1999 '));
  assert.ok(salto && salto.righe > 0);
  assert.match(testo, new RegExp(`\\[… qui mancano ${salto.righe} righe della trascrizione \\(\\d+ caratteri\\), da ${salto.da} a ${salto.a} …\\]`));
  assert.match(T.notaPerModello({ stato: 'ok', testo, salto, lingua: '', automatica: false }), new RegExp(`manca il tratto da ${salto.da} a ${salto.a}`));
  // Tre ore di parlato (~30.000 parole) stanno intere.
  const treOre = Array.from({ length: 540 }, (_v, i) => ({ ms: i * 20000, testo: 'parola '.repeat(56).trim() }));
  assert.equal(T.componi(treOre).salto, null);
});

test('la lettura della pagina di un video dalla rete comincia con la trascrizione e porta la nota', async () => {
  T._cache.clear();
  PR._cache.clear();
  const r = lettore([{ baseUrl: '/api/timedtext?v=zzz&lang=it', languageCode: 'it' }]);
  const html = pagina(r).replace('<p>Descrizione', '<main><h1>Il pane in casa</h1><p>Descrizione');
  const visti = [];
  PR._dip.scarica = async (url) => {
    visti.push(url);
    if (url.includes('/api/timedtext')) return new Response(json3([[0, 'il segreto del pane è la biga']]), { status: 200 });
    if (url.includes('/watch')) return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    return new Response('', { status: 404 });
  };
  try {
    const out = await PR.leggiPagina('https://www.youtube.com/watch?v=zzzzzzzzzzz');
    assert.equal(out.ok, true);
    assert.ok(out.testo.startsWith('Trascrizione del video:\n[0:00] il segreto del pane è la biga'));
    assert.ok(out.testo.includes('Descrizione del video'));
    assert.equal(out.video.stato, 'ok');
    assert.match(out.video.nota, /comincia con la trascrizione del video \(italiano, sottotitoli del video\)/);
  } finally {
    PR._dip.scarica = safeFetch;
    T._cache.clear();
  }
});
