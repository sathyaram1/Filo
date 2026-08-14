// Unit test per src/shared/urlNav.js (#398) — la SORGENTE UNICA di "testo →
// indirizzo" ora condivisa tra il main (barra indirizzi/navigate) e il campo
// "nuova scheda" della dashboard.
//
// REGRESSIONE #398: dopo la rimozione della barra indirizzi, il campo comando
// della dashboard aveva una copia PIÙ POVERA che pretendeva un TLD alfabetico e
// quindi scartava gli indirizzi locali (localhost:3000), gli IP (127.0.0.1:8080)
// e i nomi di rete privati (192.168.1.1): li mandava all'LLM invece di aprirli.
// Questi test ASSERISCONO che `looksLikeAddress` li riconosca come indirizzi e
// che `normalizeUrl` produca l'URL giusto con lo schema giusto. Rimettendo la
// vecchia regola "solo TLD alfabetico" diventano rossi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'urlNav.js'));
const {
  looksLikeAddress, normalizeUrl, isLocalHost, isLocalNetworkName,
  canonicalizeFiloUrl, isShareableAddress,
} = globalThis.SN_URL_NAV;

// ─── il cuore del fix #398: gli indirizzi locali sono INDIRIZZI ──────────────

test('#398 looksLikeAddress riconosce gli indirizzi locali che prima cadevano', () => {
  assert.equal(looksLikeAddress('localhost:3000'), true);
  assert.equal(looksLikeAddress('127.0.0.1:8080'), true);
  assert.equal(looksLikeAddress('192.168.1.1'), true);
  assert.equal(looksLikeAddress('localhost'), true);
  assert.equal(looksLikeAddress('127.0.0.1'), true);
  assert.equal(looksLikeAddress('10.0.0.5:9000'), true);
  assert.equal(looksLikeAddress('[::1]:8080'), true);
});

test('#398 normalizeUrl apre gli indirizzi locali con lo schema http', () => {
  assert.equal(normalizeUrl('localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizeUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(normalizeUrl('192.168.1.1'), 'http://192.168.1.1');
});

// ─── i domini pubblici restano indirizzi (nessuna regressione) ──────────────

test('domini pubblici e schemi espliciti sono indirizzi', () => {
  assert.equal(looksLikeAddress('example.com'), true);
  assert.equal(looksLikeAddress('example.com:8443/admin'), true);
  assert.equal(looksLikeAddress('sub.example.co.uk/path?q=1'), true);
  assert.equal(looksLikeAddress('http://localhost:3000'), true);
  assert.equal(looksLikeAddress('https://foo.com'), true);
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
  assert.equal(normalizeUrl('example.com:8443/admin'), 'https://example.com:8443/admin');
});

// ─── i comandi/testi NON sono indirizzi (distinzione col terminale) ─────────

test('comandi shell e testi NON sono indirizzi', () => {
  assert.equal(looksLikeAddress('git'), false);            // etichetta singola, no porta
  assert.equal(looksLikeAddress('python3.11'), false);     // "TLD" numerico → non è un dominio
  assert.equal(looksLikeAddress('git log v1.2'), false);   // spazio interno
  assert.equal(looksLikeAddress('cat file.txt'), false);   // spazio interno
  assert.equal(looksLikeAddress('./script'), false);       // path locale
  assert.equal(looksLikeAddress('.\\script'), false);      // path locale (Windows)
  assert.equal(looksLikeAddress('~/x'), false);            // home
  assert.equal(looksLikeAddress('/usr/bin'), false);       // path assoluto
  assert.equal(looksLikeAddress('reddit'), false);         // parola singola
  assert.equal(looksLikeAddress('capitolo:99999'), false); // porta fuori range
  assert.equal(looksLikeAddress(''), false);
});

// ─── #252: un solo indirizzo canonico per pagina interna ─────────────────────

test('#252 canonicalizeFiloUrl riporta la forma legacy src/pages a quella corta', () => {
  // La forma prodotta dallo shim getURL('src/pages/X/Y.html') e quella del menu
  // App devono collassare sullo STESSO indirizzo, altrimenti la stessa pagina si
  // apre con due URL diversi (il bug segnalato).
  assert.equal(
    canonicalizeFiloUrl('filo://src/pages/home/home.html'),
    'filo://home/home.html',
  );
  assert.equal(
    canonicalizeFiloUrl('filo://src/pages/history/history.html'),
    'filo://history/history.html',
  );
  assert.equal(
    canonicalizeFiloUrl('filo://src/pages/spellcheck/spellcheck.html'),
    'filo://spellcheck/spellcheck.html',
  );
});

test('#252 canonicalizeFiloUrl preserva query e hash', () => {
  assert.equal(
    canonicalizeFiloUrl('filo://src/pages/home/home.html?highlight=abc'),
    'filo://home/home.html?highlight=abc',
  );
  assert.equal(
    canonicalizeFiloUrl('filo://src/pages/home/home.html#top'),
    'filo://home/home.html#top',
  );
});

test('#252 canonicalizeFiloUrl lascia intatto ciò che è già canonico o non-filo', () => {
  assert.equal(canonicalizeFiloUrl('filo://home/home.html'), 'filo://home/home.html');
  assert.equal(canonicalizeFiloUrl('filo://newtab/'), 'filo://newtab/');
  assert.equal(canonicalizeFiloUrl('https://example.com/'), 'https://example.com/');
  assert.equal(canonicalizeFiloUrl(''), '');
});

test('isLocalHost copre loopback, *.localhost e gli IP privati', () => {
  assert.equal(isLocalHost('localhost'), true);
  assert.equal(isLocalHost('app.localhost'), true);
  assert.equal(isLocalHost('127.0.0.1'), true);
  assert.equal(isLocalHost('10.1.2.3'), true);
  assert.equal(isLocalHost('192.168.0.1'), true);
  assert.equal(isLocalHost('172.16.0.1'), true);
  assert.equal(isLocalHost('[::1]'), true);
  assert.equal(isLocalHost('8.8.8.8'), false);  // IP pubblico
  assert.equal(isLocalHost('example.com'), false);
});

// ─── #437: "Copia URL" deve copiare INDIRIZZI, non pezzi di codice ───────────
//
// Un sito può mettere come src di un'immagine/filmato (o come href di un link)
// qualcosa che non è un indirizzo: un frammento `javascript:`, un `data:` che
// contiene il file per esteso, un `blob:` che muore con la pagina, o testo
// qualsiasi. Copiarlo consegna all'utente una stringa che non apre niente da
// nessuna parte. Se `isShareableAddress` tornasse `true` per questi casi (cioè
// se il fix non ci fosse), questi assert diventano rossi.

test('#437 quello che non è un indirizzo non è copiabile', () => {
  assert.equal(isShareableAddress('javascript:alert(1)'), false);
  assert.equal(isShareableAddress('javascript:void(0)'), false);
  assert.equal(isShareableAddress('JavaScript:doStuff()'), false);   // schema in maiuscolo
  assert.equal(isShareableAddress('vbscript:msgbox'), false);
  assert.equal(isShareableAddress('data:image/png;base64,AAAA'), false);
  assert.equal(isShareableAddress('blob:http://x/9a-1'), false);
  assert.equal(isShareableAddress('filesystem:http://x/temporary/f'), false);
  assert.equal(isShareableAddress('about:blank'), false);
  // Non parsabile: non era un indirizzo nemmeno per la pagina che lo conteneva.
  assert.equal(isShareableAddress('{{item.url}}'), false);
  assert.equal(isShareableAddress('non è un url'), false);
  assert.equal(isShareableAddress(''), false);
  assert.equal(isShareableAddress('   '), false);
  assert.equal(isShareableAddress(null), false);
  assert.equal(isShareableAddress(undefined), false);
});

test('#437 gli indirizzi veri restano copiabili', () => {
  assert.equal(isShareableAddress('https://example.com/foto.jpg'), true);
  assert.equal(isShareableAddress('http://127.0.0.1:8080/v.mp4'), true);
  assert.equal(isShareableAddress('  https://example.com/con-spazi-intorno  '), true);
  assert.equal(isShareableAddress('ftp://example.com/file.zip'), true);
  assert.equal(isShareableAddress('mailto:a@b.it'), true);      // il browser lo consegna all'OS
  assert.equal(isShareableAddress('tel:+390123'), true);
  assert.equal(isShareableAddress('magnet:?xt=urn:btih:abc'), true);
  assert.equal(isShareableAddress('filo://home/home.html'), true); // riapribile dentro Filo
});
