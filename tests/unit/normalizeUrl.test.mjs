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
  for (const s of ['/wiki/Roma', '/homepage', 'Users/x', '~mario']) {
    assert.ok(normalizeUrl(s).startsWith('https://www.google.com/search?q='), s);
  }
});

// #1318 — un percorso non finisce mai in una ricerca: anche fra virgolette («Copia come percorso» di Windows), fra apici
// inversi, come file:// incollato o sotto le radici dove Linux monta la chiavetta.
test('#1318 un percorso incartato o sotto /run/media è un file, non una ricerca', () => {
  assert.equal(normalizeUrl('/run/media/mario/CHIAVETTA/conto.pdf'), 'file:///run/media/mario/CHIAVETTA/conto.pdf');
  assert.equal(normalizeUrl('"C:\\Users\\agenti AI\\Documenti\\conto.pdf"'), 'file:///C:/Users/agenti%20AI/Documenti/conto.pdf');
  assert.equal(normalizeUrl('  "C:\\Users\\x.pdf"  '), 'file:///C:/Users/x.pdf');
  assert.equal(normalizeUrl('`/home/utente/a.txt`'), 'file:///home/utente/a.txt');
  assert.equal(normalizeUrl('«/media/utente/USB/a.txt»'), 'file:///media/utente/USB/a.txt');
  assert.equal(normalizeUrl("'~/Scaricati/x.pdf'"), 'file:///~/Scaricati/x.pdf');
  assert.equal(normalizeUrl('"\\\\nas\\condivisa\\x.xlsx"'), 'file://nas/condivisa/x.xlsx');
  assert.equal(normalizeUrl('"file:///C:/x/conto.pdf"'), 'file:///C:/x/conto.pdf');
  assert.equal(normalizeUrl('\\\\?\\C:\\lungo\\x.txt'), 'file:///C:/lungo/x.txt');
  for (const r of ['/mnt/c/Users/x', '/srv/dati', '/dev/sdb1', '/snap/bin', '/net/server/x', '/storage/emulated/0/Download/a.pdf']) {
    assert.ok(normalizeUrl(r).startsWith('file:///'), r);
  }
});

test('#1318 le virgolette intorno a un testo che non è un percorso restano della ricerca', () => {
  assert.equal(normalizeUrl('"ricetta carbonara"'), 'https://www.google.com/search?q=%22ricetta%20carbonara%22');
  for (const s of ['/wiki/Roma', '/runner', '/r/italy', '"/wiki/Roma"', '``', '""']) {
    assert.ok(normalizeUrl(s).startsWith('https://www.google.com/search?q='), s);
  }
});

test('#1318 pulisciPercorso: la stessa pulizia per la barra e per la lettura dei documenti', () => {
  const { pulisciPercorso } = globalThis.SN_URL_NAV;
  assert.equal(pulisciPercorso('"C:\\Users\\agenti AI\\a.pdf"'), 'C:\\Users\\agenti AI\\a.pdf');
  assert.equal(pulisciPercorso('`/home/u/a b.txt`'), '/home/u/a b.txt');
  assert.equal(pulisciPercorso('file:///home/u/a%20b.txt'), '/home/u/a b.txt');
  assert.equal(pulisciPercorso('"file:///C:/Users/agenti%20AI/a.pdf"'), 'C:/Users/agenti AI/a.pdf');
  assert.equal(pulisciPercorso('file://nas/condivisa/x.xlsx'), '\\\\nas\\condivisa\\x.xlsx');
  assert.equal(pulisciPercorso('file://localhost/etc/hosts'), '/etc/hosts');
  assert.equal(pulisciPercorso('file:///~/Scaricati/x.pdf'), '~/Scaricati/x.pdf');
  assert.equal(pulisciPercorso('  conto.pdf '), 'conto.pdf');
  assert.equal(pulisciPercorso(null), '');
});

// #1318 — con uno schema vero si carica com'è; host e porta senza http, o un percorso, li legge la barra.
test('#1318 indirizzoDaCaricare: localhost e la rete di casa con la porta sono pagine, come dalla barra', () => {
  const { indirizzoDaCaricare } = globalThis.SN_URL_NAV;
  assert.equal(indirizzoDaCaricare('localhost:3000'), 'http://localhost:3000');
  assert.equal(indirizzoDaCaricare('localhost:3000/app?x=1#y'), 'http://localhost:3000/app?x=1#y');
  assert.equal(indirizzoDaCaricare('nas.lan:5000'), 'http://nas.lan:5000');
  assert.equal(indirizzoDaCaricare('127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(indirizzoDaCaricare('example.com:8443/admin'), 'https://example.com:8443/admin');
  assert.equal(indirizzoDaCaricare('sito.it/pagina'), 'https://sito.it/pagina');
  assert.equal(indirizzoDaCaricare('C:\\x\\a.pdf'), 'file:///C:/x/a.pdf');
  assert.equal(indirizzoDaCaricare('"/run/media/u/USB/a.pdf"'), 'file:///run/media/u/USB/a.pdf');
  for (const u of ['https://x.it', 'http://localhost:3000', 'filo://newtab/', 'mailto:mario@esempio.it', 'tel:12345', 'zoommtg:join',
    'about:blank', 'data:text/html,x', 'file:///etc/hosts', 'spotify:track:6rqhFgbbKwnb9MLmUQDhG6']) {
    assert.equal(indirizzoDaCaricare(u), u, u);
  }
  assert.equal(indirizzoDaCaricare('  https://x.it  '), 'https://x.it');
  assert.equal(indirizzoDaCaricare(''), 'filo://newtab/');
});

// #1318 giro 1 — un percorso fuori dalle radici conosciute, o fra virgolette chiuse da un punto, resta un file.
test('#1318 un percorso per forma (secondo disco in /data) o col punto dopo le virgolette è un file', () => {
  assert.equal(normalizeUrl('/data/progetti/conto.pdf'), 'file:///data/progetti/conto.pdf');
  assert.equal(normalizeUrl('/dati/conto marzo.pdf'), 'file:///dati/conto%20marzo.pdf');
  assert.equal(normalizeUrl('"C:\\Users\\agenti AI\\conto.pdf".'), 'file:///C:/Users/agenti%20AI/conto.pdf');
  assert.ok(normalizeUrl('"ricetta carbonara".').startsWith('https://www.google.com/search?q='));
});

// #1318 giro 1 — quello che l'assistente chiede di aprire non diventa mai una ricerca su Google.
test('#1318 indirizzoChiesto: la posta senza mailto va al programma di posta, il resto non diventa una ricerca', () => {
  const { indirizzoChiesto, sembraPercorso } = globalThis.SN_URL_NAV;
  assert.equal(indirizzoChiesto('mario.rossi@esempio.it'), 'mailto:mario.rossi@esempio.it');
  assert.equal(indirizzoChiesto('"mario.rossi@esempio.it"'), 'mailto:mario.rossi@esempio.it');
  assert.equal(indirizzoChiesto('localhost:3000'), 'http://localhost:3000');
  assert.equal(indirizzoChiesto('https://www.google.com/search?q=gatti'), 'https://www.google.com/search?q=gatti');
  assert.equal(indirizzoChiesto('sito.it'), 'https://sito.it');
  for (const s of ['ricetta carbonara', 'Documenti\\conto.pdf', '%USERPROFILE%\\Desktop\\x.pdf', '$HOME/x.pdf', 'mario@', '']) {
    assert.equal(indirizzoChiesto(s), s ? '' : 'filo://newtab/', s);
  }
  for (const s of ['Documenti\\conto.pdf', '%USERPROFILE%\\Desktop\\x.pdf', '$HOME/x.pdf', './a.txt', '/wiki/Roma']) assert.ok(sembraPercorso(s), s);
  for (const s of ['ricetta carbonara', 'mario.rossi@esempio.it', 'gatti buffi']) assert.ok(!sembraPercorso(s), s);
});

test('#1318 giro 5 indirizzoChiesto: un percorso relativo o un nome di file non diventa un sito inventato', () => {
  const { indirizzoChiesto, sembraPercorso } = globalThis.SN_URL_NAV;
  for (const s of ['./conto.pdf', '../Documenti/conto.pdf', 'conto.pdf', '"relazione finale.docx"', 'foto.JPG']) {
    assert.equal(indirizzoChiesto(s), '', s);
    assert.ok(sembraPercorso(s), s);
  }
  // I domini veri con un'estensione che sembra di file restano siti; un percorso assoluto resta il suo file.
  for (const s of ['obsidian.md', 'bun.sh', 'docs.rs', 'sito.it', 'esempio.com/report.pdf']) assert.match(indirizzoChiesto(s), /^https:\/\//, s);
  assert.equal(indirizzoChiesto('"file:///C:/x/conto.pdf"'), 'file:///C:/x/conto.pdf');
  assert.equal(indirizzoChiesto('/run/media/mario/CHIAVETTA/conto.pdf'), 'file:///run/media/mario/CHIAVETTA/conto.pdf');
});
