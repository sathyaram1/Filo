// Unit test per src/main/services/geoBlock.js — livello 1 deterministico del
// rilevamento geo-block (proxy-per-tab-spec.md §4): classificazione di status
// HTTP, pattern di redirect e pattern di testo, più il registro del segnale.
// Logica pura: gira via `npm run test:unit` senza Electron né rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const G = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'geoBlock.js'));

test('matchStatus: 451 è geo-block conclusivo, tutto il resto no (403 è ambiguo → livello LLM)', () => {
  assert.equal(G.matchStatus(451), G.SOURCES.HTTP_451);
  assert.equal(G.matchStatus('451'), G.SOURCES.HTTP_451);
  assert.equal(G.matchStatus(403), null); // ambiguo: bot-block/paywall → livello 2
  assert.equal(G.matchStatus(200), null);
  assert.equal(G.matchStatus(404), null);
  assert.equal(G.matchStatus(undefined), null);
});

test('matchRedirectUrl: pattern curati sul path del redirect', () => {
  assert.ok(G.matchRedirectUrl('https://ex.com/geo'));
  assert.ok(G.matchRedirectUrl('https://ex.com/geo/'));
  assert.ok(G.matchRedirectUrl('https://ex.com/geo-blocked'));
  assert.ok(G.matchRedirectUrl('https://ex.com/errors/geoblock.html'));
  assert.ok(G.matchRedirectUrl('https://ex.com/not-available'));
  assert.ok(G.matchRedirectUrl('https://ex.com/notavailable.html'));
  assert.ok(G.matchRedirectUrl('https://ex.com/region-block'));
  assert.ok(G.matchRedirectUrl('https://ex.com/help/country-blocked'));
  assert.ok(G.matchRedirectUrl('https://ex.com/geo-restricted?from=video'));
  assert.ok(G.matchRedirectUrl('https://ex.com/content-unavailable-in-your-region'));
});

test('matchRedirectUrl: niente falsi positivi su URL normali', () => {
  assert.equal(G.matchRedirectUrl('https://ex.com/'), null);
  assert.equal(G.matchRedirectUrl('https://ex.com/video/12345'), null);
  // "geo" come sottostringa di una parola NON matcha (geologia, geometry…)
  assert.equal(G.matchRedirectUrl('https://ex.com/geologia/articolo'), null);
  assert.equal(G.matchRedirectUrl('https://ex.com/geometry-dash'), null);
  // "unavailable" generico da solo NON basta (può essere un video rimosso)
  assert.equal(G.matchRedirectUrl('https://ex.com/unavailable'), null);
  assert.equal(G.matchRedirectUrl('not-a-url'), null);
  assert.equal(G.matchRedirectUrl('filo://newtab/geo'), null); // solo http(s)
  assert.equal(G.matchRedirectUrl(''), null);
});

test('matchText: messaggi espliciti noti (YouTube, Vimeo, Cloudflare, 451)', () => {
  // YouTube
  assert.ok(G.matchText('The uploader has not made this video available in your country'));
  assert.ok(G.matchText('Video unavailable\nThis video is not available in your country'));
  // Vimeo / embed generici
  assert.ok(G.matchText('Sorry, this video is not available in your region.'));
  assert.ok(G.matchText('This content is unavailable in your country.'));
  assert.ok(G.matchText('This service is blocked in your region due to licensing.'));
  // Cloudflare error 1009 (country block)
  assert.ok(G.matchText('Error 1009 Ray ID: xyz — Access denied'));
  assert.ok(G.matchText('The owner of this website has banned the country or region your IP address is in (IT) from accessing this website.'));
  // Pagina standard del 451
  assert.ok(G.matchText('451: Unavailable For Legal Reasons'));
  // Varianti italiane
  assert.ok(G.matchText('Questo video non è disponibile nel tuo paese.'));
  assert.ok(G.matchText("Il contenuto non e' disponibile nella tua area geografica."));
});

test('matchText: il caso ambiguo NON matcha (resta alla coda LLM, livello 2)', () => {
  assert.equal(G.matchText('This content is unavailable.'), null); // generico
  assert.equal(G.matchText('This video has been removed by the uploader.'), null);
  assert.equal(G.matchText('Please sign in to view this content.'), null); // login wall
  assert.equal(G.matchText('Subscribe to continue reading.'), null); // paywall
  assert.equal(G.matchText('404 — page not found'), null);
  assert.equal(G.matchText(''), null);
  assert.equal(G.matchText(null), null);
});

test('matchText: normalizza spazi multipli e apostrofi tipografici', () => {
  assert.ok(G.matchText('non  È   disponibile\n nel tuo paese'));
  assert.ok(G.matchText('non e’ disponibile nel tuo paese'));
});

test('classify: la prima fonte che matcha vince (status > redirect > testo)', () => {
  assert.deepEqual(
    G.classify({ statusCode: 451, redirectUrl: 'https://ex.com/geo', text: 'x' }),
    { source: G.SOURCES.HTTP_451, detail: 'http_451' },
  );
  const r = G.classify({ statusCode: 200, redirectUrl: 'https://ex.com/geo-blocked' });
  assert.equal(r.source, G.SOURCES.REDIRECT);
  const t = G.classify({ statusCode: 200, text: 'not available in your country' });
  assert.equal(t.source, G.SOURCES.TEXT);
  assert.equal(G.classify({ statusCode: 200, text: 'tutto ok' }), null);
  assert.equal(G.classify({}), null);
});

test('onDetected/emitDetected: registro del segnale interno, con unsubscribe', () => {
  const seen = [];
  const off = G.onDetected((s) => seen.push(s));
  const signal = { tabId: 't1', url: 'https://ex.com/x', host: 'ex.com', source: 'http_451', detail: 'http_451', at: 1 };
  G.emitDetected(signal);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], signal);
  // un listener che lancia non rompe gli altri
  const off2 = G.onDetected(() => { throw new Error('boom'); });
  G.emitDetected(signal);
  assert.equal(seen.length, 2);
  off2();
  off();
  G.emitDetected(signal);
  assert.equal(seen.length, 2); // disiscritto: non riceve più
});
