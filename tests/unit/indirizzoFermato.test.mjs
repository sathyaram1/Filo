// #482 — un indirizzo che Filo ferma per sicurezza lo dice con una riga: cosa è stato fermato e perché.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { avvisoIndirizzoFermato, indirizzoRifiutatoDaChromium } = require('../../src/main/services/indirizzoFermato.js');
const testo = (u) => avvisoIndirizzoFermato(u)?.testo;

test('un file del computer nomina il percorso, col disco di Windows senza la barra davanti', () => {
  assert.equal(testo('file:///C:/Users/agenti%20AI/Documenti/conto.pdf'), 'File del computer bloccato per sicurezza: C:/Users/agenti AI/Documenti/conto.pdf');
  assert.equal(testo('file:///etc/passwd'), 'File del computer bloccato per sicurezza: /etc/passwd');
  assert.equal(testo('file:///C:/Users/'), 'Cartella del computer bloccata per sicurezza: C:/Users/');
});

test('una cartella di rete nomina il server', () => {
  assert.equal(testo('file://nas/condivisa/bilancio.xlsx'), 'Percorso di rete bloccato per sicurezza: //nas/condivisa/bilancio.xlsx');
  assert.equal(testo('file://server-ostile/x'), 'Percorso di rete bloccato per sicurezza: //server-ostile/x');
});

test('data:, javascript: e gli altri schemi nominano solo lo schema, mai il contenuto', () => {
  assert.equal(testo('data:text/html,<script>alert(1)</script>'), 'Indirizzo «data:» bloccato per sicurezza');
  assert.equal(testo('javascript:alert(document.cookie)'), 'Indirizzo «javascript:» bloccato per sicurezza');
  assert.equal(testo('JavaScript:void(0)'), 'Indirizzo «javascript:» bloccato per sicurezza');
  assert.equal(testo('zoommtg://zoom.us/join?confno=1'), 'Indirizzo «zoommtg:» bloccato per sicurezza');
});

test('un percorso lunghissimo si accorcia in mezzo e tiene il nome del file', () => {
  const lungo = `file:///C:/${'cartella/'.repeat(40)}relazione finale.pdf`;
  const t = testo(lungo);
  assert.ok(t.length < 120, t);
  assert.ok(t.includes('…'), t);
  assert.ok(t.endsWith('relazione finale.pdf'), t);
  assert.ok(t.includes('C:/cartella'), t);
  const schema = testo(`${'x'.repeat(300)}:qualcosa`);
  assert.ok(schema.length < 80, schema);
});

test('un percorso pieno di emoji si accorcia senza spezzarne una', () => {
  const t = testo(`file:///tmp/${'📁'.repeat(80)}/foto.jpg`);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(t), t);
  assert.ok(t.endsWith('/foto.jpg'), t);
});

test('a capo e spazi di troppo non spezzano la riga', () => {
  assert.equal(testo('file:///tmp/a%0A%0Ab.txt'), 'File del computer bloccato per sicurezza: /tmp/a b.txt');
});

test('un indirizzo illeggibile non produce un avviso; uno uguale ha la stessa chiave', () => {
  assert.equal(avvisoIndirizzoFermato(''), null);
  assert.equal(avvisoIndirizzoFermato('non è un indirizzo'), null);
  assert.equal(avvisoIndirizzoFermato('file:///a.txt').chiave, avvisoIndirizzoFermato('file:///a.txt').chiave);
  assert.notEqual(avvisoIndirizzoFermato('file:///a.txt').chiave, avvisoIndirizzoFermato('file:///b.txt').chiave);
});

test('un percorso nella cartella di casa si mostra con la tilde, come è stato scritto', () => {
  assert.equal(testo('file:///~/Scaricati/x.pdf'), 'File del computer bloccato per sicurezza: ~/Scaricati/x.pdf');
});

// #1318 — un file: o un data: aperto da script dopo un clic Chromium lo rifiuta prima di Filo: resta la sua riga in console.
test('dalla riga di Chromium che rifiuta si ricava l\'indirizzo; da ogni altra riga niente', () => {
  assert.equal(indirizzoRifiutatoDaChromium('Not allowed to load local resource: file:///tmp/conto.pdf'), 'file:///tmp/conto.pdf');
  assert.equal(indirizzoRifiutatoDaChromium('Not allowed to load local resource: file://nas/c/x.xlsx'), 'file://nas/c/x.xlsx');
  assert.equal(indirizzoRifiutatoDaChromium('Not allowed to navigate top frame to data URL: data:text/html,ciao'), 'data:text/html,ciao');
  assert.equal(testo(indirizzoRifiutatoDaChromium('Not allowed to navigate top frame to data URL: data:text/html,<b>x</b>')), 'Indirizzo «data:» bloccato per sicurezza');
  for (const riga of ['', 'Uncaught TypeError: x is undefined', 'Not allowed to load local resource: ', 'prima Not allowed to load local resource: file:///x',
    'Not allowed to load local resource: https://esempio.it/x', 'Refused to frame data:text/html,x']) {
    assert.equal(indirizzoRifiutatoDaChromium(riga), '', riga);
  }
});

// #1318 giro 1 — la riga di Chromium la può scrivere anche la pagina: l'avviso nomina il sito e il tipo, mai il percorso.
test('quello che una pagina web si vede rifiutare nomina il sito, non il percorso scelto dalla pagina', () => {
  const { avvisoDallaPagina } = require('../../src/main/services/indirizzoFermato.js');
  assert.equal(avvisoDallaPagina('file:///Chiama il 02 1234 5678 per sbloccare', 'intranet.it').testo, 'File del computer chiesto da intranet.it: bloccato per sicurezza');
  assert.equal(avvisoDallaPagina('file://nas/condivisa/x.xlsx', 'intranet.it').testo, 'Percorso di rete chiesto da intranet.it: bloccato per sicurezza');
  assert.equal(avvisoDallaPagina('data:text/html,<b>finta banca</b>', '').testo, 'Indirizzo «data:» chiesto da questa pagina: bloccato per sicurezza');
  assert.equal(avvisoDallaPagina('zoommtg://x', 'intranet.it'), null);
});

test('un percorso che Filo non sa dove porta si dice com\'è scritto; un testo qualunque non è un indirizzo', () => {
  const { avvisoPercorsoScritto, avvisoNonIndirizzo } = require('../../src/main/services/indirizzoFermato.js');
  assert.equal(avvisoPercorsoScritto('%USERPROFILE%\\Desktop\\conto.pdf'), 'File del computer bloccato per sicurezza: %USERPROFILE%/Desktop/conto.pdf');
  assert.equal(avvisoNonIndirizzo('ricetta carbonara'), '«ricetta carbonara» non è un indirizzo');
});
