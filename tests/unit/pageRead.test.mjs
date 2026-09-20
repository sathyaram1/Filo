// Unit test per la lettura di una pagina web (azione LEGGI_PAGINA).
//
// Il buco che chiude: la chat poteva cercare sul web e aprire una scheda, ma il
// contenuto della pagina non tornava mai al modello. Per un prezzo, un orario o
// una clausola scritti DENTRO la pagina, Filo poteva solo indovinare dal
// riassunto di 240 caratteri della ricerca.
//
// Qui si asserisce il successo dal punto di vista dell'utente: il DATO che sta
// nella pagina esce davvero, e la cornice del sito (menu, pubblicità, piè di
// pagina) no. Senza l'estrattore ogni test qui sotto è rosso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const PR = require(join(ROOT, 'src', 'main', 'services', 'pageRead.js'));

const buf = (s) => Buffer.from(s, 'utf8');

// ─────────────────────── il dato che l'utente sta chiedendo ──────────────────

const PAGINA_PREZZI = `<!DOCTYPE html>
<html lang="it"><head>
  <title>Listino modelli — Costi per milione di token</title>
  <meta name="description" content="Confronto dei modelli usciti questa settimana.">
  <style>.x{color:red}</style>
  <script>window.dataLayer=[{prezzo:"9999"}];</script>
</head><body>
  <header class="site-header"><a href="/">Torna alla home</a></header>
  <nav><ul><li>Prodotti</li><li>Prezzi</li><li>Contatti</li></ul></nav>
  <div class="cookie-banner">Questo sito usa i cookie. Accetta tutto.</div>
  <main>
    <h1>Listino modelli</h1>
    <p>I prezzi sono in dollari per milione di token.</p>
    <table>
      <tr><th>Modello</th><th>Input</th><th>Output</th></tr>
      <tr><td>deepseekV4PRO</td><td>0,40</td><td>0,80</td></tr>
      <tr><td>kimi k2.6</td><td>0,95</td><td>1,90</td></tr>
    </table>
    <p>Il contesto in cache costa <strong>0,04</strong> dollari.</p>
  </main>
  <aside class="related"><h2>Leggi anche</h2><p>Dieci trucchi per risparmiare</p></aside>
  <footer class="site-footer">© 2026 Listino — Privacy — Termini</footer>
  <div id="ads"><p>Compra adesso a soli 19,99!</p></div>
</body></html>`;

test('il numero che sta nella pagina esce davvero, col suo contesto', async () => {
  const r = await PR.daContenuto({ url: 'https://esempio.test/listino', contentType: 'text/html; charset=utf-8', buffer: buf(PAGINA_PREZZI) });
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'html');
  assert.equal(r.empty, false);
  assert.match(r.text, /deepseekV4PRO/);
  assert.match(r.text, /0,40/);
  assert.match(r.text, /0,80/);
  assert.match(r.text, /0,04/);
  // La riga della tabella resta una riga: «deepseekV4PRO0,400,80» non si legge.
  assert.match(r.text, /deepseekV4PRO\s+0,40\s+0,80/);
});

test('il titolo della pagina torna a parte', async () => {
  const r = await PR.daContenuto({ url: 'https://esempio.test/listino', contentType: 'text/html', buffer: buf(PAGINA_PREZZI) });
  assert.equal(r.title, 'Listino modelli — Costi per milione di token');
});

test('menu, cookie, pubblicità e piè di pagina non entrano nel contesto', async () => {
  const r = await PR.daContenuto({ url: 'https://esempio.test/listino', contentType: 'text/html', buffer: buf(PAGINA_PREZZI) });
  for (const rumore of ['Torna alla home', 'Contatti', 'usa i cookie', '19,99', 'Termini', 'Dieci trucchi']) {
    assert.ok(!r.text.includes(rumore), `la cornice del sito è finita nel testo: ${rumore}`);
  }
});

test('script e stili non arrivano mai al modello', async () => {
  const r = await PR.daContenuto({ url: 'https://esempio.test/listino', contentType: 'text/html', buffer: buf(PAGINA_PREZZI) });
  assert.ok(!r.text.includes('dataLayer'));
  assert.ok(!r.text.includes('9999'));
  assert.ok(!r.text.includes('color:red'));
});

// ───────────────────────────── estrazione, i casi storti ─────────────────────

test('senza <main> si legge il corpo, e una pagina di soli <div> funziona', () => {
  const { testo } = PR.estraiContenuto('<html><body><div><div>Apre alle <b>7:30</b></div></div></body></html>');
  assert.match(testo, /Apre alle 7:30/);
});

test('un <main> che non contiene niente non fa sparire la pagina', () => {
  const html = '<html><body><main><div id="app"></div></main><div>Il totale è 42 euro</div></body></html>';
  const { testo } = PR.estraiContenuto(html);
  assert.match(testo, /42 euro/);
});

test('di una discussione arrivano tutti i messaggi, non solo il primo', () => {
  // Ogni messaggio è un <article>: tenere il primo come fosse la zona di
  // contenuto buttava via la risposta, che è il dato che l'utente cerca (#553).
  const html = '<html><body><div class="wrap">'
    + '<article><h1>Quanto costa il bollo?</h1><p>Ho una utilitaria del 2015.</p></article>'
    + '<article><p>Per quella cilindrata sono 128,40 euro all\'anno.</p></article>'
    + '</div></body></html>';
  const { testo } = PR.estraiContenuto(html);
  assert.match(testo, /utilitaria/);
  assert.match(testo, /128,40/);
});

test('quello che sta accanto all\'articolo non sparisce', () => {
  const html = '<html><body>'
    + '<article><h1>Quanto costa il bollo?</h1><p>Non trovo il dato.</p></article>'
    + '<div class="risposte"><p>Sono 128,40 euro all\'anno.</p></div>'
    + '</body></html>';
  const { testo } = PR.estraiContenuto(html);
  assert.match(testo, /128,40/);
});

test('il codice della pagina non esce mai come se fosse il suo testo', () => {
  // Un sito che si costruisce nel browser ha il corpo vuoto: la potatura non
  // lascia niente, e il ripiego rimetteva dentro script e blocchi nascosti. Il
  // modello rispondeva sul codice invece di dire che non c'è niente (#553).
  const html = '<html><body><div id="root"></div>'
    + '<script>window.__DATI__={a:1};function avvia(){}</script>'
    + '<script type="application/json">{"props":{"p":19.9}}</script>'
    + '<div style="display:none">Il caffè costa 1 euro.</div>'
    + '</body></html>';
  const { testo } = PR.estraiContenuto(html);
  assert.equal(testo, '');
});

test('una classe che CONTIENE una parola di rumore non viene buttata via', () => {
  // `header-price` contiene «header»: un confronto per sottostringa qui
  // farebbe sparire proprio il prezzo che l'utente sta chiedendo.
  const html = '<html><body><div class="header-price">Prezzo: 42,50</div><div class="header">Menu</div></body></html>';
  const { testo } = PR.estraiContenuto(html);
  assert.match(testo, /42,50/);
  assert.ok(!testo.includes('Menu'));
});

test('elementi nascosti (aria-hidden, display:none, role) restano fuori', () => {
  const html = '<html><body>'
    + '<div aria-hidden="true">invisibile</div>'
    + '<div style="display:none">nascosto</div>'
    + '<div role="navigation">barra</div>'
    + '<p>Il dato: 7</p></body></html>';
  const { testo } = PR.estraiContenuto(html);
  assert.match(testo, /Il dato: 7/);
  for (const x of ['invisibile', 'nascosto', 'barra']) assert.ok(!testo.includes(x));
});

test('un tag non chiuso non manda via il resto della pagina', () => {
  const { testo } = PR.estraiContenuto('<html><body><nav><ul><li>voce<div><p>Il risultato è 3-1</p></body></html>');
  assert.match(testo, /3-1/);
});

test('una pagina scritta per far esplodere l\'estrattore non lo blocca', () => {
  // Il testo viene da sconosciuti: un tag con migliaia di virgolette spaiate e
  // mai chiuso deve costare un istante, non un processo appeso.
  const cattivo = `<html><body><div ${'"a" '.repeat(4000)}<p>Il totale è 99,90</p></body></html>`;
  const t0 = Date.now();
  const { testo } = PR.estraiContenuto(cattivo);
  assert.ok(Date.now() - t0 < 2000, 'estrazione troppo lenta su input ostile');
  assert.match(testo, /99,90/);
});

test('le voci di elenco diventano righe, non una parola sola', () => {
  const t = PR.htmlATesto('<ul><li>primo</li><li>secondo</li></ul>');
  assert.match(t, /•\s*primo\n•\s*secondo/);
});

test('le entità HTML tornano caratteri', () => {
  assert.equal(PR.decodeEntita('5&nbsp;&euro; &amp; 3&#8364; &lt;b&gt; &#x2014;'), '5 € & 3€ <b> —');
});

test('il titolo ripiega su og:title e poi sul primo h1', () => {
  assert.equal(PR.titoloDa('<meta property="og:title" content="Quanto costa"><body><h1>Altro</h1>'), 'Quanto costa');
  assert.equal(PR.titoloDa('<body><h1>Solo l&#39;acca uno</h1>'), 'Solo l\'acca uno');
});

// ───────────────────────────── tipi di contenuto ─────────────────────────────

test('una pagina di testo semplice torna com\'è', async () => {
  const r = await PR.daContenuto({ url: 'https://esempio.test/robots.txt', contentType: 'text/plain', buffer: buf('User-agent: *\nDisallow:') });
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'text');
  assert.match(r.text, /User-agent/);
});

test('JSON è leggibile, un\'immagine no — e il motivo si può riferire all\'utente', async () => {
  const j = await PR.daContenuto({ url: 'https://esempio.test/api', contentType: 'application/json', buffer: buf('{"prezzo": 42}') });
  assert.equal(j.ok, true);
  assert.match(j.text, /42/);

  const img = await PR.daContenuto({ url: 'https://esempio.test/foto.png', contentType: 'image/png', buffer: Buffer.from([0x89, 0x50]) });
  assert.equal(img.ok, false);
  assert.equal(img.error, 'unsupported');
  assert.match(img.detail, /immagine/);
});

test('un errore del sito si riferisce, non si inventa il contenuto', async () => {
  const r = await PR.daContenuto({ url: 'https://esempio.test/x', contentType: 'text/html', buffer: buf('<h1>Not found</h1>'), status: 404 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'http_error');
  assert.match(r.detail, /404/);
});

test('una pagina senza testo lo dice invece di tornare vuota in silenzio', async () => {
  const r = await PR.daContenuto({ url: 'https://esempio.test/spa', contentType: 'text/html', buffer: buf('<html><body><div id="root"></div></body></html>') });
  assert.equal(r.ok, true);
  assert.equal(r.empty, true);
});

test('una pagina lunghissima si tronca DICHIARANDOLO', async () => {
  const lungo = `<html><body><p>${'parola '.repeat(40000)}</p></body></html>`;
  const r = await PR.daContenuto({ url: 'https://esempio.test/lungo', contentType: 'text/html', buffer: buf(lungo) });
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.equal(r.text.length, PR.MAX_TEXT_CHARS);
});

test('il charset dichiarato viene rispettato (accenti di un vecchio sito italiano)', async () => {
  const r = await PR.daContenuto({
    url: 'https://esempio.test/vecchio',
    contentType: 'text/html; charset=iso-8859-1',
    buffer: Buffer.from('<html><body><p>Caff\xE8 a 1,20</p></body></html>', 'latin1'),
  });
  assert.match(r.text, /Caffè a 1,20/);
});

// ───────────────────────────── indirizzo e guardie ───────────────────────────

test('l\'indirizzo si normalizza, e quello che non è web viene respinto', () => {
  assert.equal(PR.normalizzaUrl(' "esempio.test/a" '), 'https://esempio.test/a');
  assert.equal(PR.normalizzaUrl('https://esempio.test/a?b=1'), 'https://esempio.test/a?b=1');
  assert.equal(PR.normalizzaUrl('file:///etc/passwd'), '');
  assert.equal(PR.normalizzaUrl('filo://options/options.html'), '');
  assert.equal(PR.normalizzaUrl('javascript:alert(1)'), '');
  assert.equal(PR.normalizzaUrl(''), '');
});

test('stessa pagina anche con frammento, barra finale e maiuscole nel dominio', () => {
  assert.ok(PR.stessoIndirizzo('https://Esempio.test/a/', 'https://esempio.test/a#sez'));
  assert.ok(!PR.stessoIndirizzo('https://esempio.test/a', 'https://esempio.test/b'));
  assert.ok(!PR.stessoIndirizzo('https://esempio.test/a?x=1', 'https://esempio.test/a?x=2'));
});

test('un indirizzo che non è una pagina web viene rifiutato con la spiegazione', async () => {
  const r = await PR.readPage('file:///etc/passwd');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'bad_url');
  assert.match(r.detail, /http/);
});

test('la rete privata resta fuori: né loopback né indirizzi interni', async () => {
  for (const url of ['http://127.0.0.1:8080/x', 'http://localhost/x', 'http://192.168.1.10/x', 'http://169.254.169.254/latest/meta-data']) {
    const r = await PR.readPage(url);
    assert.equal(r.ok, false, `${url} non doveva essere letto`);
    assert.equal(r.error, 'blocked_private_address', `${url}: ${r.error}`);
    assert.match(r.detail, /rete locale|non è un sito pubblico/);
  }
});

test('una pagina già aperta in una scheda vince sullo scaricamento', async () => {
  let chiesta = '';
  const r = await PR.readPage('http://127.0.0.1:9/qualsiasi', {
    leggiScheda: async (u) => { chiesta = u; return { text: 'Il totale è 1234 euro', title: 'Fattura' }; },
  });
  assert.equal(chiesta, 'http://127.0.0.1:9/qualsiasi');
  assert.equal(r.ok, true);
  assert.equal(r.source, 'scheda');
  assert.equal(r.title, 'Fattura');
  assert.match(r.text, /1234/);
});

test('se la scheda non ha niente da dare si ripiega sullo scaricamento', async () => {
  const r = await PR.readPage('http://127.0.0.1:9/x', { leggiScheda: async () => null });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'blocked_private_address');
});

test('un sito segnalato come pericoloso non si legge', async () => {
  const prima = globalThis.SN_SAFEBROWSE;
  globalThis.SN_SAFEBROWSE = { analyze: () => ({ level: 'pericoloso', reasons: ['gsb_phishing'] }) };
  try {
    const r = await PR.readPage('https://esca.test/login', { leggiScheda: async () => ({ text: 'password', title: 'Banca' }) });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'blocked_dangerous');
  } finally {
    if (prima === undefined) delete globalThis.SN_SAFEBROWSE; else globalThis.SN_SAFEBROWSE = prima;
  }
});

// ── il dato che sta nell'intestazione dell'articolo (#553, giro 1) ───────────

const ARTICOLO_CON_DATA = `<!DOCTYPE html>
<html lang="it"><head><title>Rincaro del canone</title></head><body>
  <header class="site-header"><a href="/">Il Giornale</a></header>
  <nav><ul><li>Cronaca</li></ul></nav>
  <main><article>
    <header class="entry-header">
      <h1>Rincaro del canone</h1>
      <p class="meta">Pubblicato il 12 marzo 2026 alle 14:30 da Anna Bianchi</p>
    </header>
    <p>Il gestore ha annunciato l'aumento.</p>
    <div class="ads">Compra adesso</div>
    <table>
      <tr class="header"><td>Piano</td><td>Canone mensile</td></tr>
      <tr><td>Base</td><td>19,90 euro</td></tr>
    </table>
    <aside class="related">Leggi anche</aside>
  </article></main>
  <footer class="site-footer">© 2026</footer>
</body></html>`;

test('data, ora e firma dell\'articolo arrivano al modello', () => {
  const { testo } = PR.estraiContenuto(ARTICOLO_CON_DATA);
  assert.match(testo, /12 marzo 2026/);
  assert.match(testo, /14:30/);
  assert.match(testo, /Anna Bianchi/);
  assert.match(testo, /Il gestore ha annunciato/);
});

test('la riga di testata di una tabella porta i nomi delle colonne, anche marcata «header»', () => {
  const { testo } = PR.estraiContenuto(ARTICOLO_CON_DATA);
  assert.match(testo, /Canone mensile/);
  assert.match(testo, /19,90/);
});

test('l\'intestazione del SITO resta fuori anche quando quella dell\'articolo entra', () => {
  const { testo } = PR.estraiContenuto(ARTICOLO_CON_DATA);
  assert.doesNotMatch(testo, /Il Giornale/);
  assert.doesNotMatch(testo, /Cronaca/);
  assert.doesNotMatch(testo, /Compra adesso/);
  assert.doesNotMatch(testo, /Leggi anche/);
});

// ── i tetti si dichiarano, e non danno la colpa a chi ha scritto il file ─────

test('una pagina tagliata dal tetto sui byte non si spaccia per intera', async () => {
  const r = await PR.daContenuto({
    url: 'https://esempio.test/lunga', contentType: 'text/html; charset=utf-8',
    buffer: buf('<html><body><main><p>Solo l\'inizio</p>'), partial: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.partial, true);
});

test('un PDF tagliato dal tetto non viene dichiarato danneggiato', async () => {
  const finto = buf('%PDF-1.4\n% questo documento finisce qui perche e stato tagliato');
  const mozzo = await PR.daContenuto({ url: 'https://esempio.test/a.pdf', contentType: 'application/pdf', buffer: finto, partial: true });
  assert.equal(mozzo.ok, false);
  assert.doesNotMatch(String(mozzo.detail), /danneggiato|password/);
  assert.match(String(mozzo.detail), /MB/);
  // Un PDF davvero rotto, arrivato tutto, resta un PDF rotto.
  const rotto = await PR.daContenuto({ url: 'https://esempio.test/a.pdf', contentType: 'application/pdf', buffer: finto });
  assert.match(String(rotto.detail), /danneggiato/);
});

test('leggere una pagina dal web e leggerla dal disco hanno lo stesso tetto', () => {
  const DR = require(join(ROOT, 'src', 'main', 'services', 'documentRead.js'));
  assert.equal(PR.MAX_BYTES, DR.MAX_FILE_BYTES);
});

// ── quello che una pagina scritta apposta non deve poter fare (#553, giro 2) ──

test('una coda di tag mai chiusi non blocca l\'estrazione, e non arriva al modello', () => {
  // Con la scansione a regex ogni tag senza il suo «>» faceva riscandire tutto
  // il resto: 256 KB costavano 52 secondi col processo main fermo.
  const html = `<html><body><p>Lo sportello apre alle 9:30.</p>${'<a'.repeat(128 * 1024)}`;
  const t0 = Date.now();
  const { testo } = PR.estraiContenuto(html);
  assert.ok(Date.now() - t0 < 2000, `estrazione troppo lenta: ${Date.now() - t0} ms`);
  assert.match(testo, /9:30/);
  // Un tag che non chiude mai si porta dietro il resto, come per un browser:
  // non è testo, e non deve mangiarsi lo spazio che il modello dedica alla pagina.
  assert.doesNotMatch(testo, /<a<a/);
});

test('un commento che non si chiude mai non costa la pagina al quadrato', () => {
  const html = `<html><body><p>Il totale è 42.</p>${'<!--'.repeat(64 * 1024)}`;
  const t0 = Date.now();
  const { testo } = PR.estraiContenuto(html);
  assert.ok(Date.now() - t0 < 2000, `estrazione troppo lenta: ${Date.now() - t0} ms`);
  assert.match(testo, /42/);
});

test('oltre il tetto sull\'HTML da attraversare si taglia, e lo si dichiara', async () => {
  const zavorra = '<p>riga di riempimento che non dice niente</p>'.repeat(220_000);
  const html = `<html><body><main><p>In cima c'è 19,90.</p>${zavorra}<p>In fondo le 9:30.</p></main></body></html>`;
  assert.ok(html.length > PR.MAX_HTML_CHARS);
  const r = await PR.daContenuto({ url: 'https://esempio.test/lunga', contentType: 'text/html', buffer: buf(html) });
  assert.equal(r.ok, true);
  assert.equal(r.partial, true);
  assert.match(r.text, /19,90/);
});

// ── l'intestazione dell'articolo su una pagina senza main né article ─────────

const CRONACA_DI_SOLI_DIV = `<!DOCTYPE html>
<html lang="it"><head><title>Il Giornale del Paese</title></head><body>
  <header class="site-header"><a href="/">Il Giornale del Paese</a></header>
  <nav><ul><li>Cronaca</li></ul></nav>
  <div class="post">
    <header class="entry-header">
      <h1>Sciopero dei treni</h1>
      <p class="byline">Pubblicato il 12 marzo 2026 alle 14:30 da Anna Bianchi</p>
    </header>
    <div class="entry-content"><p>I convogli si fermano dalle 9 alle 17.</p></div>
  </div>
  <footer class="site-footer">© 2026</footer>
</body></html>`;

test('data, ora, firma e titolo del pezzo arrivano anche senza <main> né <article>', () => {
  const { testo } = PR.estraiContenuto(CRONACA_DI_SOLI_DIV);
  assert.match(testo, /12 marzo 2026/);
  assert.match(testo, /14:30/);
  assert.match(testo, /Anna Bianchi/);
  assert.match(testo, /Sciopero dei treni/);
  assert.match(testo, /dalle 9 alle 17/);
});

test('la cornice del sito resta fuori anche su una pagina di soli div', () => {
  const { testo } = PR.estraiContenuto(CRONACA_DI_SOLI_DIV);
  assert.doesNotMatch(testo, /Il Giornale del Paese/);
  assert.doesNotMatch(testo, /Cronaca/);
  assert.doesNotMatch(testo, /© 2026/);
});

// ── la codifica dichiarata dentro la pagina ─────────────────────────────────

test('un vecchio sito che dichiara la codifica nel <meta> si legge senza rombi', async () => {
  const pagina = '<!DOCTYPE html><html><head><meta charset="ISO-8859-1"><title>Trattoria</title>'
    + '</head><body><main><p>Il caffè costa 1,20 €, il menù 18 €.</p></main></body></html>';
  const byte = Buffer.from([...pagina].map((c) => {
    const n = c.codePointAt(0);
    if (n === 0x20ac) return 0x80;
    return n < 256 ? n : 0x3f;
  }));
  // Nessun charset nell'intestazione: è il caso comune di quei siti.
  const r = await PR.daContenuto({ url: 'https://esempio.test/menu', contentType: 'text/html', buffer: byte });
  assert.equal(r.ok, true);
  assert.match(r.text, /caffè/);
  assert.match(r.text, /1,20 €/);
  assert.doesNotMatch(r.text, /�/);
});

// ── quello che stava nella pagina e non arrivava (#553, terzo giro) ──────────

test('le risposte sotto una domanda sono contenuto, non rumore', () => {
  const { testo } = PR.estraiContenuto('<!DOCTYPE html><html><head><title>Bollo</title></head><body>'
    + '<nav>Home Forum</nav>'
    + '<main><article><h1>Quanto costa il bollo?</h1><p>Qualcuno lo sa?</p></article>'
    + '<section id="comments"><h2>3 risposte</h2>'
    + '<div class="comment"><p>Per quella cilindrata sono 128,40 euro all\'anno.</p></div>'
    + '</section></main><footer class="site-footer">2026</footer></body></html>');
  // Il numero esiste solo nella risposta: buttarla via è lo stesso buco che
  // LEGGI_PAGINA doveva chiudere.
  assert.match(testo, /128,40/);
  assert.doesNotMatch(testo, /Home Forum/);
});

test('gli accenti scritti come entità arrivano come lettere', () => {
  const { testo } = PR.estraiContenuto('<html><body><main><p>'
    + 'Men&uacute;: cr&egrave;me br&ucirc;l&eacute;e, ni&ntilde;o, Fran&ccedil;ois, Stra&szlig;e, &Eacute;lodie.'
    + '</p></main></body></html>');
  assert.match(testo, /Menú/);
  assert.match(testo, /crème brûlée/);
  assert.match(testo, /niño/);
  assert.match(testo, /François/);
  assert.match(testo, /Straße/);
  assert.match(testo, /Élodie/);
  assert.doesNotMatch(testo, /&/);
});

test('un maggiore dentro un attributo non fa sbucare il codice fra il testo', () => {
  const { testo } = PR.estraiContenuto('<html><body><main>'
    + '<p>Il modello <a href="/cerca?q=a>b" title="confronto">XZ</a> costa 42 euro.</p>'
    + '</main></body></html>');
  assert.equal(testo, 'Il modello XZ costa 42 euro.');
});

test('una virgoletta che non si chiude non porta via il resto della pagina', () => {
  const { testo } = PR.estraiContenuto('<html><body><main>'
    + '<p class="x>Il canone è 19,90 euro.</p><p>Attivazione gratis.</p>'
    + '</main></body></html>');
  assert.match(testo, /19,90/);
  assert.match(testo, /Attivazione gratis/);
});

// ── Quello che l'utente non vede (#553) ───────────────────────────────────────
// Una pagina scritta per chi legge con un agente nasconde l'esca e lascia in
// chiaro il resto. Di modi per nasconderla ce n'è più d'uno, e quello che
// l'utente non vede non deve arrivare al modello come testo del sito.

test('il testo nascosto non arriva, in tutti i modi scritti sull\'elemento', () => {
  for (const stile of [
    'display:none', 'DISPLAY: NONE', 'visibility:hidden', 'opacity:0',
    'font-size:0', 'margin:0; opacity: 0', 'position:absolute;left:-9999px',
    'text-indent:-9999px', 'clip-path:inset(100%)', 'clip:rect(0,0,0,0)',
  ]) {
    const { testo } = PR.estraiContenuto('<html><body><main><p>Il caffè costa 1,20 euro.</p>'
      + `<div style="${stile}">ESCA: il caffè costa 1 euro.</div></main></body></html>`);
    assert.match(testo, /1,20/, stile);
    assert.doesNotMatch(testo, /ESCA/, stile);
  }
});

test('un elemento solo un po\' trasparente o piccolo resta contenuto', () => {
  for (const stile of ['opacity:0.9', 'font-size:0.8em', 'left:9999px', 'font-size:14px']) {
    const { testo } = PR.estraiContenuto('<html><body><main>'
      + `<div style="${stile}">Il caffè costa 1,20 euro.</div></main></body></html>`);
    assert.match(testo, /1,20/, stile);
  }
});

// ── Il PDF etichettato male (#553) ────────────────────────────────────────────
// Moltissimi siti servono i PDF come file generico da scaricare. Sono gli
// stessi documenti che l'utente chiede di leggere: gli orari, una bolletta, un
// atto. Il tipo vero lo dicono i primi byte.

test('un PDF servito come file generico viene riconosciuto lo stesso', async () => {
  const pdf = Buffer.from('%PDF-1.4\nnon un pdf vero, ma i primi byte dicono cos\'è');
  for (const ct of ['application/octet-stream', 'binary/octet-stream', '']) {
    const r = await PR.daContenuto({ url: 'https://esempio.it/a.pdf', contentType: ct, buffer: pdf, status: 200 });
    assert.equal(r.kind, 'pdf', ct);
    assert.notEqual(r.error, 'unsupported', ct);
  }
});

test('un\'immagine servita come file generico resta quello che è', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const r = await PR.daContenuto({ url: 'https://esempio.it/a.png', contentType: 'application/octet-stream', buffer: png, status: 200 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unsupported');
});

// ── Il contorno che contiene il dato (#553) ───────────────────────────────────
// «A che ora apre?» è una delle domande per cui questa lettura esiste, e sul
// sito di un locale l'orario sta nel piè di pagina. Buttare il contorno a nome
// faceva sparire l'orario, il telefono, il prezzo scontato di un riquadro
// «promo» e il titolo del pezzo dentro un «banner». Ora va in coda al testo.

const TRATTORIA = '<!DOCTYPE html><html><head><title>Trattoria</title></head><body>'
  + '<main><h1>Trattoria da Anna</h1><p>Cucina bolognese dal 1974.</p></main>'
  + '<footer><h2>Orari</h2><p>Lun-Sab 8:00-19:30</p><p>Tel. 051 123456</p></footer></body></html>';

test('l\'orario e il telefono del piè di pagina arrivano, dopo il contenuto', () => {
  const { testo } = PR.estraiContenuto(TRATTORIA);
  assert.match(testo, /Cucina bolognese/);
  assert.match(testo, /8:00-19:30/);
  assert.match(testo, /051 123456/);
  assert.ok(testo.indexOf('Cucina bolognese') < testo.indexOf('8:00-19:30'));
});

test('il prezzo scontato di un riquadro «promo» non sparisce', () => {
  const { testo } = PR.estraiContenuto('<body><main><section class="promo"><p>In offerta: 4,99</p></section>'
    + '<p>Prezzo di listino: 9,99</p></main></body>');
  assert.match(testo, /9,99/);
  assert.match(testo, /4,99/);
});

test('il titolo e la data dentro un «banner» non spariscono', () => {
  const { testo } = PR.estraiContenuto('<body><main><div class="banner"><h1>Sciopero dei treni</h1>'
    + '<p>Pubblicato il 12 marzo 2026 alle 14:30</p></div><p>Corpo.</p></main></body>');
  assert.match(testo, /Sciopero dei treni/);
  assert.match(testo, /14:30/);
});

test('menu, cookie e pubblicità restano fuori anche dalla coda', () => {
  const { testo } = PR.estraiContenuto('<body><nav>Home Contatti</nav>'
    + '<div class="cookie-banner">Accetta tutto</div><div id="ads">Compra a 19,99</div>'
    + '<main><p>Il dato: 7</p></main><footer><p>Orari 8-19</p></footer></body>');
  assert.match(testo, /Il dato: 7/);
  assert.match(testo, /Orari 8-19/);
  for (const rumore of ['Home Contatti', 'Accetta tutto', '19,99']) {
    assert.ok(!testo.includes(rumore), `la cornice è finita nel testo: ${rumore}`);
  }
});

test('la coda ha un tetto: un elenco di link non si mangia la lettura', () => {
  const link = Array.from({ length: 2000 }, (_, i) => `<p>Voce numero ${i}</p>`).join('');
  const { testo } = PR.estraiContenuto(`<body><main><p>Il dato: 7</p></main><footer>${link}</footer></body>`);
  assert.match(testo, /Il dato: 7/);
  assert.ok(testo.length < PR.MAX_CODA_CHARS + 200, `coda senza tetto: ${testo.length}`);
});

// ── Quello che sta nei controlli di un modulo (#553) ──────────────────────────
// Sullo schermo le voci di un menù a tendina e i bottoni sono riquadri
// separati: incollandoli si ottiene un orario che non esiste.

test('le voci di un menù a tendina non si incollano fra loro', () => {
  const { testo } = PR.estraiContenuto('<body><main><select><option>10:00</option>'
    + '<option>14:30</option><option>18:00</option></select></main></body>');
  assert.ok(!testo.includes('10:0014:30'), testo);
  assert.match(testo, /14:30/);
});

test('le etichette di due bottoni non si incollano fra loro', () => {
  const { testo } = PR.estraiContenuto('<body><main><button>Mensile 9,99</button>'
    + '<button>Annuale 99,00</button></main></body>');
  assert.ok(!testo.includes('9,99Annuale'), testo);
});

test('il valore di un campo e il testo alternativo di un\'immagine arrivano', () => {
  const { testo } = PR.estraiContenuto('<body><main><label>Orario</label>'
    + '<input type="text" value="14:30"><img src="p.png" alt="12,50 euro"></main></body>');
  assert.match(testo, /14:30/);
  assert.match(testo, /12,50/);
});

test('una password precompilata e i campi nascosti non escono mai', () => {
  const { testo } = PR.estraiContenuto('<body><main><input type="password" value="segreto123">'
    + '<input type="hidden" value="token-abc"><p>Accedi</p></main></body>');
  assert.ok(!testo.includes('segreto123'), testo);
  assert.ok(!testo.includes('token-abc'), testo);
});
