// Unit test per normalizeUrl (src/main/tabs.js) — la funzione che decide, dalla
// barra degli indirizzi, se un input è un INDIRIZZO da aprire o un testo da
// CERCARE su Google. Electron è mockato così la logica gira sotto node:test
// senza avviare Electron (tabs.js richiede electron in cima).
//
// REGRESSIONE (#233 "gli indirizzi con porta finiscono in ricerca"): un input
// del tipo host:porta (localhost:3000, 127.0.0.1:8080, example.com:8443/admin)
// veniva classificato come ricerca invece che come indirizzo. Anche un host
// locale senza punto ("localhost") finiva in ricerca. Questi test ASSERISCONO
// che ora Filo NAVIGHI verso l'indirizzo (e con lo schema giusto: http per i
// server locali, https per i domini pubblici). Senza il fix diventano rossi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Mock minimo di 'electron': tabs.js ne importa i simboli al require ma
// normalizeUrl (pura) non li usa. Basta che l'import non esploda.
const noop = () => {};
class FakeView {}
const electronMock = {
  WebContentsView: FakeView,
  Menu: class { constructor() { this.items = []; } append() {} },
  MenuItem: class { constructor(o) { Object.assign(this, o); } },
  session: { fromPartition: () => ({ setProxy: async () => {} }) },
  shell: { openExternal: noop },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return origLoad.call(this, request, parent, isMain);
};

const { normalizeUrl } = require(join(__dirname, '..', '..', 'src', 'main', 'tabs.js'));

Module._load = origLoad; // ripristina: non inquinare gli altri test

// ─── il cuore del fix #233: host:porta naviga, non cerca ───────────────────

test('#233 localhost:3000 → naviga al server locale in http (non ricerca)', () => {
  assert.equal(normalizeUrl('localhost:3000'), 'http://localhost:3000');
});

test('#233 127.0.0.1:8080 → naviga al loopback in http', () => {
  assert.equal(normalizeUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080');
});

test('#233 example.com:8443/admin → naviga al dominio pubblico in https, path incluso', () => {
  assert.equal(normalizeUrl('example.com:8443/admin'), 'https://example.com:8443/admin');
});

test('#233 host a etichetta singola con porta (myserver:8080) → naviga (intranet, http)', () => {
  assert.equal(normalizeUrl('myserver:8080'), 'http://myserver:8080');
});

test('#233 localhost senza porta né punto → naviga in http (non ricerca)', () => {
  assert.equal(normalizeUrl('localhost'), 'http://localhost');
});

test('#233 IP privato (router/IoT) → http', () => {
  assert.equal(normalizeUrl('192.168.1.1'), 'http://192.168.1.1');
  assert.equal(normalizeUrl('192.168.1.1:8080'), 'http://192.168.1.1:8080');
  assert.equal(normalizeUrl('10.0.0.5:9000'), 'http://10.0.0.5:9000');
});

// ─── comportamento invariato (nessuna regressione) ─────────────────────────

test('dominio con punto senza porta → https (come prima)', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
  assert.equal(normalizeUrl('sub.example.com/path?q=1'), 'https://sub.example.com/path?q=1');
});

test('schema esplicito → passa immutato', () => {
  assert.equal(normalizeUrl('http://foo.com'), 'http://foo.com');
  assert.equal(normalizeUrl('https://foo.com:8443/x'), 'https://foo.com:8443/x');
  assert.equal(normalizeUrl('filo://newtab/'), 'filo://newtab/');
});

test('input vuoto → newtab', () => {
  assert.equal(normalizeUrl('   '), 'filo://newtab/');
  assert.equal(normalizeUrl(''), 'filo://newtab/');
});

test('testo di ricerca resta ricerca (parola singola, frase con spazi, ratio con spazio)', () => {
  assert.equal(normalizeUrl('reddit'), 'https://www.google.com/search?q=reddit');
  assert.ok(normalizeUrl('come stai oggi').startsWith('https://www.google.com/search?q='));
  // "score 3:0" ha uno spazio nella parte host → non è un indirizzo → ricerca.
  assert.ok(normalizeUrl('score 3:0').startsWith('https://www.google.com/search?q='));
  // porta fuori range (>65535) → non è un indirizzo valido → ricerca.
  assert.ok(normalizeUrl('capitolo:99999').startsWith('https://www.google.com/search?q='));
});

test('IP pubblico letterale con porta → https', () => {
  assert.equal(normalizeUrl('8.8.8.8:443'), 'https://8.8.8.8:443');
});

// #482 — posta, telefono e gli schemi che Filo ferma sono già indirizzi: rinavigando una scheda la posta finiva in una
// ricerca su Google invece che al programma di posta, come succede aprendo una scheda nuova.
test('#482 mailto:/tel:/sms:/data:/javascript:/file: senza «//» restano indirizzi, non ricerche', () => {
  for (const u of ['mailto:a@b.it', 'MAILTO:a@b.it?subject=ciao', 'tel:+390612345', 'tel:12345', 'sms:+39333', 'data:text/html,<b>x</b>', 'javascript:alert(1)', 'file:C:/x.txt']) {
    assert.equal(normalizeUrl(u), u, u);
  }
  assert.equal(normalizeUrl('  mailto:a@b.it  '), 'mailto:a@b.it');
});

test('#482 una parola seguita da due punti resta una ricerca', () => {
  assert.ok(normalizeUrl('ricetta: carbonara').startsWith('https://www.google.com/search?q='));
  assert.ok(normalizeUrl('ricetta:carbonara').startsWith('https://www.google.com/search?q='));
  assert.ok(normalizeUrl('posta: come si scrive').startsWith('https://www.google.com/search?q='));
});

// #482 giro 2 — un percorso del computer scritto com'è è un file da fermare e dire, non una ricerca del percorso su Google.
test('#482 un percorso del computer scritto com\'è diventa un file, non una ricerca', () => {
  assert.equal(normalizeUrl('\\\\nas\\condivisa\\bilancio.xlsx'), 'file://nas/condivisa/bilancio.xlsx');
  assert.equal(normalizeUrl('\\\\nas'), 'file://nas/');
  assert.equal(normalizeUrl('C:\\Users\\agenti AI\\Documenti\\conto.pdf'), 'file:///C:/Users/agenti%20AI/Documenti/conto.pdf');
  assert.equal(normalizeUrl('d:/foto/mare #2.jpg'), 'file:///d:/foto/mare%20%232.jpg');
  assert.equal(normalizeUrl('/home/utente/Documenti/conto.pdf'), 'file:///home/utente/Documenti/conto.pdf');
  assert.equal(normalizeUrl('/Users/mario/Desktop/'), 'file:///Users/mario/Desktop/');
  assert.equal(normalizeUrl('~/Scaricati/x.pdf'), 'file:///~/Scaricati/x.pdf');
});

test('#482 una barra davanti a una parola qualunque non è un file', () => {
  for (const s of ['/wiki/Roma', '/homepage', 'Users/x', '~mario', '/r/italy']) {
    assert.ok(normalizeUrl(s).startsWith('https://www.google.com/search?q='), s);
  }
});

// #1318 — un percorso privato non diventa mai una ricerca su Google: fra virgolette («Copia come percorso» di Windows),
// fra apici inversi, sotto /run/media (la chiavetta su Linux) o sotto una radice qualunque se finisce in un file.
test('#1318 un percorso fra virgolette, sotto /run/media o sotto una radice qualunque è un file', () => {
  const casi = [
    ['/run/media/mario/CHIAVETTA/tesi.docx', 'file:///run/media/mario/CHIAVETTA/tesi.docx'],
    ['"/run/media/mario/CHIAVETTA/tesi.docx"', 'file:///run/media/mario/CHIAVETTA/tesi.docx'],
    ['"C:\\Users\\agenti AI\\Desktop\\nota.txt"', 'file:///C:/Users/agenti%20AI/Desktop/nota.txt'],
    ['\'C:\\Users\\x.pdf\'', 'file:///C:/Users/x.pdf'],
    ['`/home/mario/a b.pdf`', 'file:///home/mario/a%20b.pdf'],
    ['“/media/mario/USB/foto.jpg”', 'file:///media/mario/USB/foto.jpg'],
    ['"\\\\nas\\condivisa\\bilancio.xlsx"', 'file://nas/condivisa/bilancio.xlsx'],
    ['/data/archivio/fattura 2026.pdf', 'file:///data/archivio/fattura%202026.pdf'],
    ['/mnt/c/Users/mario/x.txt', 'file:///mnt/c/Users/mario/x.txt'],
    ['"file:///etc/hosts"', 'file:///etc/hosts'],
  ];
  for (const [scritto, atteso] of casi) assert.equal(normalizeUrl(scritto), atteso, scritto);
  for (const [scritto] of casi) assert.ok(!/google\./.test(globalThis.SN_URL_NAV.indirizzoDaCaricare(scritto)), scritto);
});

test('#1318 le virgolette attorno a una ricerca restano: cercano la frase esatta', () => {
  assert.equal(normalizeUrl('"ricetta carbonara"'), 'https://www.google.com/search?q=%22ricetta%20carbonara%22');
});

// #1318 — chi apre per conto di Filo o del modello legge «localhost:3000» come la barra: un server, non lo schema «localhost:».
test('#1318 indirizzoDaCaricare: un host con la porta è un server, uno schema vero resta com\'è', () => {
  const { indirizzoDaCaricare } = globalThis.SN_URL_NAV;
  assert.equal(indirizzoDaCaricare('localhost:3000'), 'http://localhost:3000');
  assert.equal(indirizzoDaCaricare('nas.lan:5000'), 'http://nas.lan:5000');
  assert.equal(indirizzoDaCaricare('nas.lan:5000/admin?x=1'), 'http://nas.lan:5000/admin?x=1');
  assert.equal(indirizzoDaCaricare('  example.com:8443/x '), 'https://example.com:8443/x');
  assert.equal(indirizzoDaCaricare('sito.it/pagina'), 'https://sito.it/pagina');
  for (const u of ['about:blank', 'blob:https://a.it/1', 'zoommtg://zoom.us/join', 'spotify:track:1', 'mailto:a@b.it', 'tel:112', 'sms:12345', 'javascript:1', 'data:text/plain,1', 'file:///tmp/x', 'https://a.it', 'C:\\x.txt']) {
    assert.equal(indirizzoDaCaricare(u), u, u);
  }
  assert.equal(indirizzoDaCaricare('"C:\\Users\\x.txt"'), 'C:\\Users\\x.txt', 'fra virgolette lo stesso percorso');
});

test('#1318 percorsoPulito: virgolette, apici inversi e file:// tolti, una sola pulizia', () => {
  const { percorsoPulito } = globalThis.SN_URL_NAV;
  assert.equal(percorsoPulito(' "C:\\Users\\agenti AI\\nota.txt" '), 'C:\\Users\\agenti AI\\nota.txt');
  assert.equal(percorsoPulito('`~/Documenti/a.pdf`'), '~/Documenti/a.pdf');
  assert.equal(percorsoPulito('"`/tmp/x`"'), '/tmp/x');
  assert.equal(percorsoPulito('file:///C:/Users/agenti%20AI/a.pdf'), 'C:/Users/agenti AI/a.pdf');
  assert.equal(percorsoPulito('file:///home/mario/a%20b.pdf'), '/home/mario/a b.pdf');
  assert.equal(percorsoPulito('file://localhost/tmp/x'), '/tmp/x');
  assert.equal(percorsoPulito('file://nas/condivisa/b.xlsx'), '\\\\nas\\condivisa\\b.xlsx');
  assert.equal(percorsoPulito('""'), '');
  assert.equal(percorsoPulito('"'), '"');
});
