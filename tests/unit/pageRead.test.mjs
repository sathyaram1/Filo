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

test('<article> vince sul resto quando non c\'è <main>', () => {
  const html = '<html><body><p>Fuori</p><article><p>La sentenza è del 12 marzo.</p></article></body></html>';
  const { testo } = PR.estraiContenuto(html);
  assert.match(testo, /12 marzo/);
  assert.ok(!testo.includes('Fuori'));
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
