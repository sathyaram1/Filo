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
  canonicalizeFiloUrl, isShareableAddress, describeDestination,
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

// ─── #433: i nomi della rete di casa sono host LOCALI ────────────────────────
//
// nas.lan, raspberrypi.local, fritz.box non esistono nel DNS pubblico: li
// assegna il router. Prima venivano trattati come domini pubblici qualsiasi →
// schema https (che su un NAS o una stampante non risponde) e, soprattutto,
// sottoposti al controllo esistenza che li dichiarava inesistenti. Se si
// rimuove il riconoscimento dei suffissi locali questi assert diventano rossi.

test('#433 i suffissi di rete locale sono riconosciuti', () => {
  assert.equal(isLocalNetworkName('nas.lan'), true);
  assert.equal(isLocalNetworkName('raspberrypi.local'), true);
  assert.equal(isLocalNetworkName('stampante.home'), true);
  assert.equal(isLocalNetworkName('fritz.box'), true);
  assert.equal(isLocalNetworkName('srv.internal'), true);
  assert.equal(isLocalNetworkName('wiki.intranet'), true);
  assert.equal(isLocalNetworkName('router.home.arpa'), true);
  assert.equal(isLocalNetworkName('NAS.LAN'), true);            // maiuscole
  assert.equal(isLocalNetworkName('nas.lan.'), true);           // punto finale FQDN
  // Un'etichetta sola non è un indirizzo, e i domini pubblici restano pubblici.
  assert.equal(isLocalNetworkName('lan'), false);
  assert.equal(isLocalNetworkName('local'), false);
  assert.equal(isLocalNetworkName('example.com'), false);
  assert.equal(isLocalNetworkName('mylan.com'), false);         // non basta contenere "lan"
  assert.equal(isLocalNetworkName(''), false);
});

test('#433 isLocalHost include i nomi della rete di casa', () => {
  assert.equal(isLocalHost('nas.lan'), true);
  assert.equal(isLocalHost('raspberrypi.local'), true);
  assert.equal(isLocalHost('example.com'), false);
});

test('#433 normalizeUrl apre i dispositivi di casa in http (non https)', () => {
  assert.equal(normalizeUrl('nas.lan:8080'), 'http://nas.lan:8080');
  assert.equal(normalizeUrl('raspberrypi.local'), 'http://raspberrypi.local');
  assert.equal(normalizeUrl('stampante.lan/setup'), 'http://stampante.lan/setup');
  assert.equal(normalizeUrl('fritz.box'), 'http://fritz.box');
  // I domini pubblici restano su https.
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
});

test('#433 i nomi della rete di casa restano indirizzi, non testo', () => {
  assert.equal(looksLikeAddress('nas.lan'), true);
  assert.equal(looksLikeAddress('raspberrypi.local'), true);
  assert.equal(looksLikeAddress('nas.lan:8080'), true);
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

// ─── #499: il menu deve dire DOVE PORTA il collegamento ─────────────────────
//
// Il tasto destro guarda anche sotto al punto cliccato per ritrovare il
// collegamento di una scheda (#444). Una pagina può approfittarne: un
// collegamento invisibile ritagliato con lo stesso ingombro di un paragrafo,
// messo sotto, viene adottato dal menu — geometricamente è identico alla
// copertina di una scheda vera, e nessuna misura sa distinguerli. Le quattro
// voci del link agiscono allora su un indirizzo scelto dal sito, che da nessuna
// parte si legge (Filo non ha una barra di stato che lo mostri col mouse).
// `describeDestination` prepara la riga che lo dice, e il punto delicato è che
// la parte che risponde a "chi c'è dall'altra parte" — l'host — non venga mai
// accorciata, elisa o abbellita: è esattamente lì che passano gli inganni.

test('#499 la destinazione si legge: host da una parte, resto dall\'altra', () => {
  assert.deepEqual(
    describeDestination('https://esempio.it/promo/estate?x=1#in-fondo'),
    { label: 'esempio.it', rest: '/promo/estate?x=1#in-fondo', full: 'https://esempio.it/promo/estate?x=1#in-fondo' });
  // Radice: niente percorso da mostrare, resta il solo host.
  assert.deepEqual(
    describeDestination('https://esempio.it/'),
    { label: 'esempio.it', rest: '', full: 'https://esempio.it/' });
  // La porta fa parte di "chi risponde".
  assert.equal(describeDestination('http://192.168.1.4:8080/setup').label, '192.168.1.4:8080');
});

test('#499 l\'host mostrato è quello VERO, non quello che sembra', () => {
  // Il trucco più vecchio: quello che precede la @ è un nome utente, non l'host.
  assert.equal(describeDestination('https://www.banca.it@altro.example/accedi').label, 'altro.example');
  // Sottodominio civetta: l'host si mostra intero, mai accorciato dall'inizio.
  assert.equal(describeDestination('https://banca.it.accessi.example/login').label, 'banca.it.accessi.example');
  // `www.` NON si toglie: è parte del nome, e toglierlo è un'elisione di comodo.
  assert.equal(describeDestination('https://www.esempio.it/x').label, 'www.esempio.it');
  // Omografo (la "a" cirillica): il punycode resta scritto com'è, perché è
  // l'unica forma in cui la differenza con paypal.com si vede.
  assert.equal(describeDestination('https://pаypal.com/login').label, 'xn--pypal-4ve.com');
});

test('#499 gli schemi che non sono una destinazione lo dicono', () => {
  const js = describeDestination('javascript:frode()');
  assert.equal(js.label, 'javascript:');
  assert.equal(js.rest, 'frode()');
  assert.equal(describeDestination('mailto:qualcuno@esempio.it').label, 'mailto:');
  // Schemi con host diverso da http/https: lo schema resta davanti, perché
  // cambia il senso della frase.
  assert.equal(describeDestination('filo://home/home.html').label, 'filo://home');
  assert.equal(describeDestination('ftp://esempio.it/file.zip').label, 'ftp://esempio.it');
});

test('#499 niente indirizzo, niente riga inventata', () => {
  assert.equal(describeDestination(''), null);
  assert.equal(describeDestination('   '), null);
  assert.equal(describeDestination(null), null);
  // Non parsabile: torna com'è, senza spacciarlo per un host.
  assert.deepEqual(describeDestination('{{item.url}}'), { label: '', rest: '{{item.url}}', full: '{{item.url}}' });
});

test('#499 a capo e caratteri di controllo non spezzano la riga', () => {
  const d = describeDestination('https://esempio.it/\n\tpagina');
  assert.equal(d.label, 'esempio.it');
  assert.ok(
    !/[\u0000-\u001f\u007f]/.test(d.label + d.rest),
    'la riga mostrata non deve contenere caratteri di controllo');
});

test('#499 un indirizzo lunghissimo non sfonda la riga (host intero, resto accorciato)', () => {
  const lungo = 'https://esempio.it/' + 'x'.repeat(2000);
  const d = describeDestination(lungo);
  assert.equal(d.label, 'esempio.it');
  assert.ok(d.rest.length <= 300, 'il percorso va accorciato');
  assert.equal(d.full, lungo, 'l\'indirizzo intero resta disponibile per chi ferma il mouse');
});
