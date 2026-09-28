// Unit test per src/shared/filoMarkdown.js (#418) — la SORGENTE UNICA del
// rendering "testo di Filo -> HTML leggero" condivisa da chat della home, popup
// di risposta, riquadro "Spiega" e sidebar.
//
// Il bug #418: le risposte di Filo perdevano la formattazione (asterischi e
// parentesi quadre mostrati grezzi) e i link non erano cliccabili. Requisiti:
//   - i link diventano <a> cliccabili che aprono in nuova scheda;
//   - il testo e' NON FIDATO: un link non deve poter puntare alle pagine interne
//     dell'app (filo://), ne' essere javascript:/data:/relativo;
//   - grassetto/corsivo/codice/elenchi restano.
// Questi assert diventano ROSSI se si rimuove il rendering o il filtro di
// sicurezza sui link.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'filoMarkdown.js'));
const { render, safeLinkUrl, LINK_CLASS } = globalThis.SN_MARKDOWN;

// ─── formattazione leggera: il cuore del fix (prima si vedeva testo grezzo) ───

test('#418 grassetto/corsivo/codice diventano HTML, non asterischi grezzi', () => {
  const html = render('Vedi **grassetto**, *corsivo* e `codice`.');
  assert.match(html, /<strong>grassetto<\/strong>/);
  assert.match(html, /<em>corsivo<\/em>/);
  assert.match(html, /<code>codice<\/code>/);
  assert.doesNotMatch(html, /\*\*/);
});

test('#418 gli elenchi diventano <ul>/<ol>', () => {
  const html = render('- uno\n- due');
  assert.match(html, /<ul>[\s\S]*<li>uno<\/li>[\s\S]*<li>due<\/li>[\s\S]*<\/ul>/);
  const ol = render('1. primo\n2. secondo');
  assert.match(ol, /<ol>[\s\S]*<li>primo<\/li>[\s\S]*<li>secondo<\/li>[\s\S]*<\/ol>/);
});

// ─── link: un link scritto da Filo deve diventare cliccabile ─────────────────

test('#418 un link markdown diventa <a> cliccabile in nuova scheda', () => {
  const html = render('Guarda [Example](https://example.com).');
  assert.match(html, new RegExp(`<a class="${LINK_CLASS}"[^>]*href="https://example\\.com"`));
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="[^"]*noopener[^"]*"/);
  assert.match(html, />Example<\/a>/);
});

test('#418 un URL nudo http(s) viene reso cliccabile (autolink)', () => {
  const html = render('Fonte: https://foo.com/path?q=1 e stop.');
  assert.match(html, new RegExp(`<a class="${LINK_CLASS}"[^>]*href="https://foo\\.com/path\\?q=1"`));
  // La punteggiatura finale non deve entrare nell'href.
  const html2 = render('Vedi https://foo.com/.');
  assert.match(html2, /href="https:\/\/foo\.com\/"/);
});

test('#853 un tag HTML nella risposta si legge com\'è: l\'URL nudo si ferma alle virgolette', () => {
  const html = render('Codice: <img src="https://x.invalid/a.png"> e <a href=\'https://y.it/?a=1&b=2\'>y</a> fine.');
  assert.doesNotMatch(html, /<img|<a href=/);
  // Testo mostrato = testo scritto, senza «;» rimasti da un'entità spezzata.
  const visibile = html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.equal(visibile, 'Codice: <img src="https://x.invalid/a.png"> e <a href=\'https://y.it/?a=1&b=2\'>y</a> fine.');
  assert.match(html, /href="https:\/\/x\.invalid\/a\.png"/);
  assert.match(html, /href="https:\/\/y\.it\/\?a=1&amp;b=2"/);
});

test('#853 l\'apostrofo dentro un URL nudo fa parte del link, quello in coda no', () => {
  const wiki = render("Vedi https://it.wikipedia.org/wiki/Valle_d'Aosta per la storia.");
  assert.match(wiki, />https:\/\/it\.wikipedia\.org\/wiki\/Valle_d&#39;Aosta<\/a> per la storia/);
  assert.match(wiki, /href="https:\/\/it\.wikipedia\.org\/wiki\/Valle_d&#39;Aosta"/);
  const fine = render("Vedi https://it.wikipedia.org/wiki/L'Aquila.");
  assert.match(fine, /href="https:\/\/it\.wikipedia\.org\/wiki\/L&#39;Aquila"[^>]*>[^<]*<\/a>\.<\/p>/);
  const apici = render("Apri 'https://example.com/guida'.");
  assert.match(apici, /&#39;<a [^>]*href="https:\/\/example\.com\/guida"[^>]*>https:\/\/example\.com\/guida<\/a>&#39;\.<\/p>/);
});

test('#853 dove finisce un URL: i segni attorno restano fuori, le parentesi dell\'URL dentro', () => {
  const href = (s) => [...render(s).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  const casi = [
    ['Vedi **https://example.com/guida** qui.', 'https://example.com/guida'],
    ['Vedi *https://example.com/guida*.', 'https://example.com/guida'],
    ['La pagina «https://example.com/guida» spiega.', 'https://example.com/guida'],
    ['La pagina “https://example.com/guida”, poi.', 'https://example.com/guida'],
    ['Continua su https://example.com/guida…', 'https://example.com/guida'],
    ['Continua su https://example.com/guida’', 'https://example.com/guida'],
    ['Il pianeta: https://it.wikipedia.org/wiki/Mercurio_(astronomia).', 'https://it.wikipedia.org/wiki/Mercurio_(astronomia)'],
    ['(vedi https://it.wikipedia.org/wiki/Java_(linguaggio_di_programmazione))', 'https://it.wikipedia.org/wiki/Java_(linguaggio_di_programmazione)'],
    ['(vedi https://example.com/guida).', 'https://example.com/guida'],
    ['Il pianeta: [Mercurio](https://it.wikipedia.org/wiki/Mercurio_(astronomia)).', 'https://it.wikipedia.org/wiki/Mercurio_(astronomia)'],
    ['Dati: https://example.com/a?x=1&y=2.', 'https://example.com/a?x=1&amp;y=2'],
  ];
  for (const [testo, atteso] of casi) assert.deepEqual(href(testo), [atteso], testo);
  const grassetto = render('Vedi **https://example.com/guida** qui.');
  assert.match(grassetto, /<strong><a [^>]*>https:\/\/example\.com\/guida<\/a><\/strong>/);
  assert.match(render('La pagina «https://example.com/guida» spiega.'), /«<a [^>]*>https:\/\/example\.com\/guida<\/a>»/);
  assert.match(render('Il pianeta: [Mercurio](https://it.wikipedia.org/wiki/Mercurio_(astronomia)).'), /<\/a>\.<\/p>/);
});

// L'elenco di ciò che si stacca in coda è CHIUSO: un segno nuovo entra qui
// col suo perché, e ogni altro carattere ammesso in un URL resta nel link
// (#853: prima l'elenco cresceva a porte, e ha tagliato _ e ~).
const STACCATI = {
  '.': 'fine frase', ',': 'fine frase', ';': 'fine frase', ':': 'fine frase',
  '!': 'fine frase', '?': 'fine frase', '…': 'puntini di sospensione',
  "'": 'apostrofo di chiusura', '’': 'apostrofo tipografico di chiusura',
  '*': 'grassetto e corsivo, che Filo disegna',
};

test('#853 in coda a un URL nudo si stacca solo l\'elenco chiuso: ogni altro carattere da URL resta nel link', () => {
  const href = (s) => [...render(s).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
  // RFC 3986: non riservati, sotto-delimitatori e delimitatori ammessi nel percorso.
  const ALFABETO = "ABZabz09-._~!$&'()*+,;=:@/?#%[]" + '…’';
  for (const c of ALFABETO) {
    if (c === ')' || c === ']') continue; // parentesi: test qui sotto
    const url = 'https://example.com/a' + c;
    const atteso = c in STACCATI ? 'https://example.com/a' : esc(url);
    assert.deepEqual(href(`Vedi ${url} qui`), [atteso], `carattere ${JSON.stringify(c)}`);
  }
  assert.deepEqual(href('Vedi https://docs.python.org/3/reference/datamodel.html#object.__init__ qui.'),
    ['https://docs.python.org/3/reference/datamodel.html#object.__init__']);
  assert.deepEqual(href('Vedi https://example.com/a) e https://example.com/b(c) e https://example.com/d] qui'),
    ['https://example.com/a', 'https://example.com/b(c)', 'https://example.com/d']);
});

test('#853 una coda lunghissima dopo un URL nudo non blocca il disegno', () => {
  for (const coda of [')', '.', '*', '.)', '&#39;']) {
    const testo = 'Vedi https://example.com/pagina' + coda.repeat(50_000);
    const t0 = performance.now();
    const html = render(testo);
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `coda ${JSON.stringify(coda)}: ${Math.round(ms)} ms`);
    assert.match(html, /href="https:\/\/example\.com\/pagina"/);
  }
});

// ─── sicurezza: contenuto NON FIDATO, niente link verso l'interno dell'app ───

test('#418 un link filo:// (pagina interna) NON diventa cliccabile', () => {
  const html = render('Apri [Impostazioni](filo://preferences/preferences.html).');
  assert.doesNotMatch(html, /<a /);
  assert.doesNotMatch(html, /filo:\/\//);       // niente href interno
  assert.match(html, /Impostazioni/);            // il testo resta visibile
});

test('#418 javascript:/data:/relativi vengono scartati', () => {
  assert.equal(safeLinkUrl('javascript:alert(1)'), null);
  assert.equal(safeLinkUrl('data:text/html,x'), null);
  assert.equal(safeLinkUrl('/pages/manage'), null);      // relativo
  assert.equal(safeLinkUrl('//evil.com'), null);         // protocol-relative
  assert.equal(safeLinkUrl('file:///etc/passwd'), null);
  assert.equal(safeLinkUrl('filo://dashboard'), null);
  // Solo http/https/mailto sono ammessi.
  assert.equal(safeLinkUrl('https://ok.com'), 'https://ok.com');
  assert.equal(safeLinkUrl('http://ok.com'), 'http://ok.com');
  assert.equal(safeLinkUrl('mailto:a@b.com'), 'mailto:a@b.com');
  // Le parentesi ammesse nell'url di un link markdown non riaprono la porta.
  assert.doesNotMatch(render('[x](javascript:alert(1)) e [y](filo://manage/(a))'), /<a /);
});

test('#418 l\'HTML nel testo del modello viene neutralizzato (no XSS)', () => {
  const html = render('Un <script>alert(1)</script> e <img onerror=x>.');
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;script&gt;/);
});

test('#418 un innocente " T3 " nella prosa non viene mangiato dai segnaposto', () => {
  const html = render('La vitamina T3 e il livello T5 restano interi.');
  assert.match(html, /vitamina T3 e il livello T5/);
});
