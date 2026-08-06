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
