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

test('menu, cookie e pubblicità non entrano nel contesto', async () => {
  const r = await PR.daContenuto({ url: 'https://esempio.test/listino', contentType: 'text/html', buffer: buf(PAGINA_PREZZI) });
  for (const rumore of ['Contatti', 'usa i cookie', '19,99', 'Dieci trucchi']) {
    assert.ok(!r.text.includes(rumore), `il rumore del sito è finito nel testo: ${rumore}`);
  }
});

test('l\'intestazione e il piè di pagina del sito arrivano DOPO il contenuto', () => {
  // Non nel cestino: l'orario di un locale sta nel piè di pagina, e «a che ora
  // apre?» è una delle domande per cui questa lettura esiste (#553).
  const r = PR.estraiContenuto(PAGINA_PREZZI);
  const fine = r.testo.indexOf('0,04');
  assert.ok(fine > 0);
  for (const contorno of ['Torna alla home', 'Termini']) {
    assert.ok(r.testo.includes(contorno), `il contorno è finito nel cestino: ${contorno}`);
    assert.ok(r.testo.indexOf(contorno) > fine, `il contorno si è infilato nel contenuto: ${contorno}`);
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
  // Il riquadro chiamato «header» è contorno: va in coda, non nel cestino.
  assert.ok(testo.indexOf('Menu') > testo.indexOf('42,50'));
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

test('l\'intestazione del SITO non si mescola a quella dell\'articolo', () => {
  const { testo } = PR.estraiContenuto(ARTICOLO_CON_DATA);
  assert.doesNotMatch(testo, /Cronaca/);
  assert.doesNotMatch(testo, /Compra adesso/);
  assert.doesNotMatch(testo, /Leggi anche/);
  assert.ok(testo.indexOf('Il Giornale') > testo.indexOf('19,90'));
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

test('la cornice del sito sta in coda anche su una pagina di soli div', () => {
  const { testo } = PR.estraiContenuto(CRONACA_DI_SOLI_DIV);
  assert.doesNotMatch(testo, /Cronaca/);
  const corpo = testo.indexOf('dalle 9 alle 17');
  assert.ok(corpo > 0);
  assert.ok(testo.indexOf('Il Giornale del Paese') > corpo);
  assert.ok(testo.indexOf('© 2026') > corpo);
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

// ── il contorno va in coda, col nome che gli danno i siti veri ──────────────

const LOCALE = (pie) => '<!DOCTYPE html><html><head><title>Trattoria da Anna</title></head><body>'
  + '<main><h1>Trattoria da Anna</h1><p>Cucina bolognese dal 1974.</p></main>'
  + `${pie}</body></html>`;
const ORARI = '<h2>Orari</h2><p>Lun-Sab 8:00-19:30</p><p>Tel. 051 123456</p>';

// «A che ora apre?» è una delle domande per cui la lettura esiste, e l'orario
// sta nel piè di pagina. Chiamarlo col nome che scrivono i programmi per fare
// siti non deve cambiare la risposta (#553).
for (const [come, pie] of Object.entries({
  nudo: `<footer>${ORARI}</footer>`,
  'site-footer': `<footer id="colophon" class="site-footer">${ORARI}</footer>`,
  'page-footer': `<footer class="page-footer">${ORARI}</footer>`,
  'un div chiamato footer': `<div id="footer">${ORARI}</div>`,
  'dentro un contenitore': `<div class="wrap"><div class="footer">${ORARI}</div></div>`,
})) {
  test(`l'orario nel piè di pagina ${come} arriva a chi legge`, () => {
    const { testo } = PR.estraiContenuto(LOCALE(pie));
    assert.match(testo, /8:00-19:30/);
    assert.match(testo, /051 123456/);
  });
}

test('il titolo e la data in un\'intestazione chiamata «header» non spariscono', () => {
  const { testo } = PR.estraiContenuto('<html><body>'
    + '<header class="header"><h1>Sciopero dei treni</h1>'
    + '<p>Pubblicato il 12 marzo 2026 alle 14:30 da Anna Bianchi</p></header>'
    + '<div><p>I convogli si fermano dalle 9 alle 17.</p></div></body></html>');
  assert.match(testo, /Sciopero dei treni/);
  assert.match(testo, /14:30/);
  assert.match(testo, /Anna Bianchi/);
});

test('una riga lunga in cima alla coda non si porta via quelle dopo', () => {
  const informativa = `<p>${'Informativa sui cookie. '.repeat(400)}</p>`;
  const { testo } = PR.estraiContenuto(LOCALE(`<footer>${informativa}${ORARI}</footer>`));
  assert.match(testo, /8:00-19:30/);
});

// ── gli altri modi di nascondere il testo all'utente e non a chi legge ──────

for (const [come, stile] of Object.entries({
  'del colore dello sfondo': 'color:#ffffff;background:#ffffff',
  'col colore trasparente': 'color:transparent',
  'in un riquadro schiacciato a zero': 'width:0;height:0;overflow:hidden',
  'in un riquadro alto un pixel': 'height:1px;width:1px;overflow:hidden',
  'rimpicciolito a zero': 'transform:scale(0)',
})) {
  test(`il testo ${come} non arriva a chi legge`, () => {
    const { testo } = PR.estraiContenuto('<html><body><main><p>Il caffè costa 1,20 euro.</p>'
      + `<div style="${stile}">Il caffè è gratis.</div></main></body></html>`);
    assert.match(testo, /1,20/);
    assert.doesNotMatch(testo, /gratis/);
  });
}

test('il titolo sfumato, che si vede benissimo, resta', () => {
  // Il testo dipinto col proprio sfondo è un titolo, non un'esca.
  const { testo } = PR.estraiContenuto('<html><body><main>'
    + '<h1 style="background:linear-gradient(90deg,#f00,#00f);-webkit-background-clip:text;color:transparent">'
    + 'Offerta di primavera</h1><p>Sconto del 20%.</p></main></body></html>');
  assert.match(testo, /Offerta di primavera/);
});

// ── Il nome del riquadro non manda niente nel cestino (#553) ──────────────────
// Sul sito di un ristorante il listino sta in un riquadro chiamato «menu», e
// «quanto costa» è una delle domande per cui questa lettura esiste. Un nome che
// indica un contenitore non dice cosa c'è dentro: va in coda, non nel cestino.

test('il listino chiamato «menu» arriva, il menu di navigazione no', () => {
  for (const nome of ['id="menu"', 'class="menu"']) {
    const { testo } = PR.estraiContenuto('<body>'
      + '<nav class="navbar"><a href="#menu">Menu</a><a href="#dove">Dove siamo</a></nav>'
      + '<h1>Pizzeria Da Gino</h1>'
      + `<section ${nome}><p>Margherita 6,50 euro</p><p>Caffè 1,20 euro</p></section>`
      + '</body>');
    assert.match(testo, /Margherita 6,50/, nome);
    assert.match(testo, /1,20/, nome);
    assert.ok(!testo.includes('Dove siamo'), `il menu di navigazione è rientrato: ${nome}`);
  }
});

test('i piani di un listino non spariscono col nome del riquadro né col ruolo', () => {
  const dentro = PR.estraiContenuto('<body><h1>Piani</h1>'
    + '<div class="subscription"><p>Mensile 9,99 euro</p><p>Annuale 99,00 euro</p></div></body>');
  assert.match(dentro.testo, /9,99/);
  assert.match(dentro.testo, /99,00/);
  const schede = PR.estraiContenuto('<body><h1>Piani</h1>'
    + '<div role="tablist"><button>Mensile 9,99 euro</button><button>Annuale 99,00 euro</button></div>'
    + '<p>Scegli il piano.</p></body>');
  assert.match(schede.testo, /9,99/);
});

// ── Una pagina non tiene ferma l'app (#553) ──────────────────────────────────
// La lettura gira nel processo che tiene le finestre. Con una fila di aperture
// e una di chiusure che non si corrispondono il tempo cresceva col QUADRATO
// della pagina: 280 KB costavano quasi cinque secondi, e il tetto ne lascia
// passare otto megabyte.

test('le chiusure che non trovano la loro apertura non fanno esplodere il tempo', () => {
  const n = 40000;
  const html = `<body><p>Il caffè costa 1,20 euro</p>${'<b>'.repeat(n)}${'</i>'.repeat(n)}</body>`;
  const t0 = Date.now();
  const { testo } = PR.estraiContenuto(html);
  const ms = Date.now() - t0;
  assert.match(testo, /1,20/);
  // Margine largo: misurata sta sotto i cento millisecondi, e prima erano
  // quasi cinque secondi. Qui interessa solo che non sia più quadratico.
  assert.ok(ms < 2000, `280 KB scritti così costano ${ms} ms`);
});

test('il testo nascosto non arriva, nemmeno nei modi che prima sfuggivano', () => {
  for (const stile of [
    'opacity:0!important', 'font-size:0px!important', 'display:none !important',
    'color:white;background-color:#ffffff', 'color:#fff;background:white',
    'color:rgb(255,255,255);background-color:#ffffff',
    'position:absolute;clip-path:inset(50%)', 'font-size:0.0001px',
  ]) {
    const { testo } = PR.estraiContenuto('<html><body><main><p>Il caffè costa 1,20 euro.</p>'
      + `<div style="${stile}">ESCA: il caffè è gratis.</div></main></body></html>`);
    assert.match(testo, /1,20/, stile);
    assert.doesNotMatch(testo, /ESCA/, stile);
  }
});

// ── Piegato non è nascosto (#553) ─────────────────────────────────────────────
// In un file che nessun browser ha aperto, «display:none» è la posizione di un
// interruttore, non una promessa che l'utente non vedrà quel testo. A dire di
// quale dei due si tratta è l'interruttore che apre: se sulla pagina c'è, quel
// testo è contenuto; se non c'è, resta un'esca e non arriva.

const FAQ = (chiusura, comando) => '<html><head><title>Trattoria</title></head><body><main>'
  + '<h1>Trattoria da Gino</h1>'
  + `<h3>${comando}</h3>`
  + `<div id="r1" ${chiusura}><p>Siamo aperti dalle 8:00 alle 19:30.</p></div>`
  + '</main></body></html>';

test('la risposta di una domanda frequente chiusa arriva, comunque sia chiusa', () => {
  for (const chiusura of ['style="display:none"', 'hidden', 'aria-hidden="true"',
    'style="visibility:hidden"', 'style="content-visibility:hidden"']) {
    const { testo } = PR.estraiContenuto(FAQ(chiusura, '<button aria-controls="r1">A che ora aprite?</button>'));
    assert.match(testo, /8:00 alle 19:30/, chiusura);
  }
});

test('lo stesso blocco chiuso, senza niente che lo apra, resta fuori', () => {
  for (const chiusura of ['style="display:none"', 'hidden', 'aria-hidden="true"',
    'style="visibility:hidden"', 'style="content-visibility:hidden"']) {
    const { testo } = PR.estraiContenuto(FAQ(chiusura, 'A che ora aprite?'));
    assert.doesNotMatch(testo, /8:00 alle 19:30/, chiusura);
  }
});

test('basta il comando che sta subito prima, o dentro l\'intestazione della voce', () => {
  const vicino = PR.estraiContenuto('<html><body><main><p>Prima parte.</p>'
    + '<button>Leggi tutto</button>'
    + '<div style="display:none"><p>Si pagano 128,40 euro all\'anno.</p></div></main></body></html>');
  assert.match(vicino.testo, /128,40/);
  const dentro = PR.estraiContenuto('<html><body><main><h3><button>Quanto costa?</button></h3>'
    + '<div style="display:none"><p>Costa 128,40 euro.</p></div></main></body></html>');
  assert.match(dentro.testo, /128,40/);
});

test('la scheda non attiva di un listino non porta via il suo prezzo', () => {
  const { testo } = PR.estraiContenuto('<html><body><main><h1>Prezzi</h1>'
    + '<div role="tabpanel"><p>Mensile 9,99 euro</p></div>'
    + '<div role="tabpanel" style="display:none"><p>Annuale 99,00 euro</p></div></main></body></html>');
  assert.match(testo, /99,00/);
});

test('con una finestra aperta sopra, il resto della pagina resta contenuto', () => {
  // Ogni libreria di consenso marca tutto il resto come nascosto agli
  // assistivi: è il modo standard di dire «adesso si parla solo qui».
  const { testo } = PR.estraiContenuto('<html><head><title>Trattoria</title></head><body>'
    + '<div id="root" aria-hidden="true"><h1>Trattoria</h1><p>Orari: lun-sab 8:00-19:30</p></div>'
    + '<div role="dialog" aria-modal="true"><p>Questo sito usa i cookie</p></div></body></html>');
  assert.match(testo, /8:00-19:30/);
  assert.doesNotMatch(testo, /usa i cookie/);
});

test('i prezzi in un riquadro chiamato «subscribe» non finiscono nel cestino', () => {
  for (const nome of ['id="subscribe"', 'class="subscribe"']) {
    const { testo } = PR.estraiContenuto('<html><body><h1>Piani</h1>'
      + `<section ${nome}><p>Mensile 9,99 euro</p><p>Annuale 99,00 euro</p></section></body></html>`);
    assert.match(testo, /9,99/, nome);
    assert.match(testo, /99,00/, nome);
  }
});

test('gli altri modi di nascondere il testo agli occhi restano chiusi', () => {
  for (const stile of [
    'visibility:collapse', 'content-visibility:hidden', 'transform:translateX(-9999px)',
    'font-size:0.0001em', 'font-size:1px', 'opacity:0.001', 'opacity:0.05',
  ]) {
    const { testo } = PR.estraiContenuto('<html><body><main><p>Il caffè costa 1,20 euro.</p>'
      + `<div style="${stile}">ESCA: il caffè è gratis.</div></main></body></html>`);
    assert.match(testo, /1,20/, stile);
    assert.doesNotMatch(testo, /ESCA/, stile);
  }
});

test('un testo solo un po\' piccolo o sbiadito resta contenuto', () => {
  for (const stile of ['font-size:12px', 'font-size:0.8em', 'opacity:0.4', 'font-size:80%']) {
    const { testo } = PR.estraiContenuto('<html><body><main>'
      + `<div style="${stile}">Nota a margine: 42</div></main></body></html>`);
    assert.match(testo, /42/, stile);
  }
});

test('la codifica dichiarata dopo una lunga intestazione si rispetta lo stesso', async () => {
  const imbottitura = '<link rel="preload" as="style" href="/a/aaaaaaaaaaaaaaaaaaaaaaaaaaaa.css">\n'.repeat(70);
  const html = `<html><head>${imbottitura}<meta charset="iso-8859-1"><title>Bar</title></head>`
    + '<body><main><p>Il caff\xE8 costa 1,20 \x80</p></main></body></html>';
  const r = await PR.daContenuto({
    url: 'https://bar.test/', contentType: 'text/html', buffer: Buffer.from(html, 'latin1'),
  });
  assert.match(r.text, /caffè/);
  assert.match(r.text, /1,20 €/);
});
