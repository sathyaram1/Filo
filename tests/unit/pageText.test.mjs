// Dal codice HTML al testo che Filo legge con LEGGI_PAGINA (#553): il contenuto resta, il contorno del sito no.
// Il numero dentro una tabella deve arrivare; menu, cookie, pubblicità e script non devono mangiarsi il tetto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PT = require(join(ROOT, 'src', 'main', 'services', 'pageText.js'));

const PROSA = 'Questa settimana sono usciti tre modelli nuovi e li abbiamo provati tutti su compiti veri, '
  + 'dalla scrittura al codice, annotando quanto costano e quanto rendono rispetto ai concorrenti.';

const ARTICOLO = `<!doctype html><html lang="it"><head><title>Modelli &amp; prezzi — Blog</title>
<meta name="description" content="Il listino della settimana"><script>var x = "</div><p>NON_DEVE_USCIRE</p>";</script>
<style>p { color: red }</style></head>
<body class="has-sidebar">
<header class="site-header"><nav><a href="/">Home</a> <a href="/blog">VOCE_DI_MENU</a></nav></header>
<div id="cookie-banner">Accetta i COOKIE_FASTIDIOSI <button>OK</button></div>
<main><article>
<header><h1>Nuovi modelli della settimana</h1><p>di Mario, 3 settembre</p></header>
<p>${PROSA}</p>
<table><thead><tr><th>Modello<th>Input $/M<th>Output $/M</tr></thead>
<tbody><tr><td>Lampo 4<td>0,07<td>0,28<tr><td>Kappa 2.6<td>0,95<td>4,00</tr></tbody></table>
<ul><li>Primo <a href="/dettagli">approfondimento</a><li>Secondo<ul><li>annidato</ul></ul>
<pre>riga uno
  riga due indentata</pre>
<div class="share-bar">CONDIVIDI_SU_SOCIAL</div>
<p style="display:none">TESTO_NASCOSTO</p>
<p hidden>ANCHE_NASCOSTO</p>
<div data-sn-ui="menu">MENU_DI_FILO</div>
</article>
<aside class="sidebar">ARTICOLI_CORRELATI</aside></main>
<footer>© 2026 PIEDE_DEL_SITO</footer></body></html>`;

test('dell\'articolo restano titolo, prosa, tabella ed elenchi; il contorno del sito sparisce', () => {
  const r = PT.estrai(ARTICOLO, { url: 'https://blog.example/post/1' });
  assert.equal(r.titolo, 'Modelli & prezzi — Blog');
  assert.equal(r.descrizione, 'Il listino della settimana');
  assert.equal(r.lingua, 'it');
  assert.match(r.testo, /^# Nuovi modelli della settimana/m);
  assert.ok(r.testo.includes('di Mario, 3 settembre'), 'l\'intestazione dell\'articolo è contenuto');
  assert.ok(r.testo.includes(PROSA));
  assert.ok(r.testo.includes('Modello | Input $/M | Output $/M'));
  assert.ok(r.testo.includes('Lampo 4 | 0,07 | 0,28'), 'la riga di tabella arriva intera, coi numeri');
  assert.ok(r.testo.includes('Kappa 2.6 | 0,95 | 4,00'));
  assert.ok(r.testo.includes('- Primo [approfondimento](https://blog.example/dettagli)'), 'i link relativi diventano assoluti');
  assert.ok(r.testo.includes('\n  - annidato'));
  assert.ok(r.testo.includes('riga uno\n  riga due indentata'), 'il testo preformattato tiene i suoi spazi');
  for (const via of ['NON_DEVE_USCIRE', 'VOCE_DI_MENU', 'COOKIE_FASTIDIOSI', 'MENU_DI_FILO', 'color: red']) {
    assert.ok(!r.testo.includes(via), `non deve esserci: ${via}`);
  }
  // Il contorno non si butta: va dopo il contenuto, sotto un titolo; quello che la pagina tiene chiuso ancora dopo.
  const coda = r.testo.indexOf('[Contorno della pagina');
  const chiusi = r.testo.indexOf('[Chiuso o nascosto nella pagina');
  assert.ok(coda > r.testo.indexOf('riga due indentata') && chiusi > coda);
  for (const inCoda of ['CONDIVIDI_SU_SOCIAL', 'ARTICOLI_CORRELATI', 'PIEDE_DEL_SITO']) {
    assert.ok(r.testo.indexOf(inCoda) > coda && r.testo.indexOf(inCoda) < chiusi, `in coda: ${inCoda}`);
  }
  for (const chiuso of ['TESTO_NASCOSTO', 'ANCHE_NASCOSTO']) assert.ok(r.testo.indexOf(chiuso) > chiusi, `fra i chiusi: ${chiuso}`);
  assert.equal(r.soloJavaScript, false);
});

test('senza articolo né parte principale si legge il corpo; la navigazione fatta di link sparisce, il piede va in coda', () => {
  const html = `<html><body><div class="top-nav"><a href="/a">MENU_UNO</a></div>
<div class="contenuto"><h2>Orari</h2><p>${PROSA}</p><p>Apertura alle 9:30, chiusura alle 18:45.</p></div>
<footer>PIEDE</footer></body></html>`;
  const r = PT.estrai(html, { url: 'https://negozio.example/' });
  assert.ok(r.testo.includes('## Orari'));
  assert.ok(r.testo.includes('Apertura alle 9:30, chiusura alle 18:45.'));
  assert.ok(!r.testo.includes('MENU_UNO'));
  assert.ok(r.testo.indexOf('PIEDE') > r.testo.indexOf('[Contorno della pagina'));
});

// #553, giro 12: il nome del riquadro decideva il cestino, e gli stessi nomi stanno sul contenuto.
test('i riquadri col dato chiesto arrivano qualunque nome abbiano: in coda il contorno, fra i chiusi i pannelli', () => {
  const casi = [
    ['piè di pagina di WordPress', `<div id="page"><div id="content"><h1>Trattoria</h1><p>${PROSA}</p></div><footer id="colophon" class="site-footer"><p>Orari: lun-sab 8:00-19:30</p></footer></div>`, 'lun-sab 8:00-19:30'],
    ['listino chiamato menu', `<h1>Pizzeria</h1><p>${PROSA}</p><section id="menu"><p>Margherita 6,50 euro</p></section>`, 'Margherita 6,50'],
    ['menu di navigazione con i prezzi', `<h1>Pizzeria</h1><p>${PROSA}</p><ul class="menu"><li>Margherita 6,50</li><li>Diavola 7,50</li></ul>`, 'Diavola 7,50'],
    ['promo', `<h1>Offerta</h1><p>${PROSA}</p><div class="promo">In offerta: 4,99 euro al mese</div>`, '4,99 euro al mese'],
    ['subscribe', `<h1>Piani</h1><p>${PROSA}</p><div class="subscribe"><p>Annuale 99,00 euro</p></div>`, 'Annuale 99,00'],
    ['alternative', `<h1>Scarpe</h1><p>${PROSA}</p><div class="related"><p>Scarpe blu 49,00 euro</p></div>`, 'Scarpe blu 49,00'],
    ['intestazione di un pezzo non marcato', `<div class="post"><header><h1>Sciopero</h1><p>Pubblicato il 12 marzo 2026 alle 14:30</p></header><p>${PROSA}</p></div>`, 'alle 14:30'],
    ['riquadro affiancato', `<article><h1>Trapano</h1><p>${PROSA}</p><aside>Peso: 1,2 kg</aside></article>`, 'Peso: 1,2 kg'],
    ['prezzo per gli occhi e per i lettori di schermo', `<h1>Cuffie</h1><p>${PROSA}</p><p>Prezzo: <span aria-hidden="true">129,90 €</span><span class="visually-hidden">129 euro e 90</span></p>`, '129,90 € 129 euro e 90'],
    ['tendina e bottoni', `<h1>Prenota</h1><p>${PROSA}</p><select><option>10:00<option>14:30</select><button>Mensile 9,99</button><button>Annuale 99,00</button>`, '10:00 / 14:30 Mensile 9,99 Annuale 99,00'],
    ['prezzo in un\'immagine', `<h1>Menu</h1><p>${PROSA}</p><img src="p.png" alt="Pizza del giorno 8 euro">`, 'Pizza del giorno 8 euro'],
    ['risposta chiusa', `<h1>FAQ</h1><p>${PROSA}</p><button aria-controls="r">A che ora aprite?</button><div id="r" hidden>Dalle 8:00 alle 19:30</div>`, 'Dalle 8:00 alle 19:30'],
    ['pagina coperta dal consenso', `<div id="pagina" aria-hidden="true"><h1>Trattoria</h1><p>${PROSA}</p><p>Aperti dalle 8:00</p></div><div role="dialog">Questo sito usa i cookie</div>`, 'Aperti dalle 8:00'],
  ];
  for (const [nome, corpo, dato] of casi) {
    const r = PT.estrai(`<html><body>${corpo}</body></html>`);
    assert.ok(r.testo.includes(dato), `${nome}: manca «${dato}» in\n${r.testo}`);
  }
});

test('il testo scritto dove nessun gesto lo mostra non arriva; una dissolvenza in attesa sì', () => {
  const esche = ['opacity:0', 'opacity: 0 !important', 'font-size:0', 'text-indent:-9999px', 'position:absolute;left:-9999px',
    'clip:rect(0 0 0 0);position:absolute', 'clip-path:inset(50%)', 'transform:scale(0)', 'color:transparent',
    'width:0;height:0;overflow:hidden'];
  for (const st of esche) {
    const r = PT.estrai(`<html><body><h1>Bar</h1><p>${PROSA}</p><p style="${st}">ESCA gratis per gli assistenti</p></body></html>`);
    assert.ok(!r.testo.includes('ESCA'), st);
  }
  const animata = PT.estrai(`<html><body><h1>Bar</h1><p>${PROSA}</p><p style="opacity:0;transform:translateY(20px)">APPARE_SCORRENDO</p></body></html>`);
  assert.ok(animata.testo.includes('APPARE_SCORRENDO'));
  const velo = PT.estrai(`<html><body><div style="opacity:0"><h1>Bar</h1><p>${PROSA}</p></div></body></html>`);
  assert.ok(velo.testo.includes(PROSA), 'una pagina tutta sotto un velo trasparente si legge lo stesso');
});

test('il tempo della lettura cresce con la pagina, non col suo quadrato', () => {
  const casi = [
    `<html><body><p>ciao</p>${'<a'.repeat(200000)}</body></html>`,
    `<html><body><p>${'<span>ok </span>'.repeat(150000)}</p></body></html>`,
    `<html><body>${'<a href="/x">'.repeat(400)}${'<p>parola parola parola</p>'.repeat(40000)}</body></html>`,
    `<html><body>${'<table><tr><td>'.repeat(130)}${'<p>parola parola</p>'.repeat(40000)}</body></html>`,
  ];
  for (const html of casi) {
    const t0 = Date.now();
    PT.estrai(html);
    assert.ok(Date.now() - t0 < 1500, `${html.slice(0, 40)}…: ${Date.now() - t0} ms`);
  }
});

test('un sito che chiama «menu» il contenitore di tutto non resta a mani vuote', () => {
  const html = `<html><body><div class="menu"><p>${PROSA}</p><p>Il prezzo è 12,50 euro.</p></div></body></html>`;
  const r = PT.estrai(html);
  assert.ok(r.testo.includes('Il prezzo è 12,50 euro.'));
});

test('entità: nominate, numeriche ed esadecimali; quelle sconosciute restano come sono', () => {
  assert.equal(PT.decodificaEntita('10&nbsp;&euro; &#8364; &#x20AC; &egrave; &amp;amp; &foo; &#0;'), '10 € € € è &amp; &foo; �');
  const r = PT.estrai('<p>Costo:&nbsp;3&nbsp;&euro; &mdash; IVA&nbsp;inclusa</p>');
  assert.equal(r.testo, 'Costo: 3 € — IVA inclusa');
});

test('link: solo http e https, niente ancore né javascript, e il <base> della pagina vale', () => {
  const html = `<html><head><base href="https://altro.example/cartella/"></head><body>
<p><a href="pagina.html">relativo</a> <a href="#sez">ancora</a> <a href="javascript:alert(1)">codice</a>
<a href="mailto:a@b.it">posta</a></p></body></html>`;
  const r = PT.estrai(html, { url: 'https://sito.example/' });
  assert.ok(r.testo.includes('[relativo](https://altro.example/cartella/pagina.html)'));
  assert.ok(r.testo.includes('ancora'));
  assert.ok(!r.testo.includes('javascript:'));
  assert.ok(!r.testo.includes('mailto:'));
});

test('un sito che si costruisce in JavaScript, scaricato senza eseguirlo, si riconosce', () => {
  const html = `<!doctype html><html><head><title>App</title><script src="/a.js"></script><script src="/b.js"></script>
<script>window.__DATI__ = {}</script></head><body><div id="root"></div>
<noscript>You need to enable JavaScript to run this app.</noscript></body></html>`;
  const r = PT.estrai(html);
  assert.equal(r.testo, '');
  assert.equal(r.soloJavaScript, true);
});

test('HTML rotto, un «<» nel testo e un annidamento sproporzionato non lo fanno cadere', () => {
  const rotto = '<p>se a < b allora <b>grassetto<p>secondo paragrafo<div><span>chiusure storte</div></span>';
  const r = PT.estrai(rotto);
  assert.ok(r.testo.includes('se a < b allora grassetto'));
  assert.ok(r.testo.includes('secondo paragrafo'));
  assert.ok(r.testo.includes('chiusure storte'));
  const profondo = `${'<div>'.repeat(20000)}IN_FONDO${'</div>'.repeat(20000)}`;
  assert.ok(PT.estrai(profondo).testo.includes('IN_FONDO'));
  assert.equal(PT.estrai('').testo, '');
  assert.equal(PT.estrai(null).testo, '');
});

test('un attributo con dentro «>» fra virgolette non spezza il tag', () => {
  const r = PT.estrai('<p title="a > b">dentro</p><p>fuori</p>');
  assert.equal(r.testo, 'dentro\n\nfuori');
});

test('i nomi di classe riconosciuti come contorno, senza colpire le parole che li contengono', () => {
  for (const s of ['nav', 'site-nav', 'main-menu', 'cookie-banner', 'ad-slot', 'share', 'social_links', 'sidebar', 'breadcrumbs']) {
    assert.equal(PT.nomeDiContorno(s), true, s);
  }
  for (const s of ['navigator', 'has-sidebar', 'content', 'header', 'entry-header', 'lead', 'shared-results', 'admin']) {
    assert.equal(PT.nomeDiContorno(s), false, s);
  }
});

test('con più articoli (una pagina elenco) si leggono tutti, non solo il primo', () => {
  const html = `<html><body><main>
<article><h2>Primo</h2><p>${PROSA} UNO</p></article>
<article><h2>Secondo</h2><p>${PROSA} DUE</p></article></main></body></html>`;
  const r = PT.estrai(html);
  assert.ok(r.testo.includes('UNO') && r.testo.includes('DUE'));
});
