// #1905 — Un file del computer si apre in una scheda se l'utente ne ha dato il percorso: quale indirizzo è un file di
// questo computer (mai una cartella di rete), quando il percorso l'ha scritto lui, e che aprirlo non è un'uscita di dati.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
require('../../src/shared/urlNav.js');
require('../../src/shared/urlExfil.js');
require('../../src/shared/actionLevels.js');
const N = globalThis.SN_URL_NAV;
const F = require('../../src/main/services/fileDelComputer.js');

test('un file di questo computer, scritto come indirizzo o com\'è, diventa un indirizzo file:', () => {
  assert.equal(N.fileDiQuestoComputer('file:///C:/Users/agenti%20AI/Desktop/r.html'), 'file:///C:/Users/agenti%20AI/Desktop/r.html');
  assert.equal(N.fileDiQuestoComputer('C:\\Users\\agenti AI\\Desktop\\r.html'), 'file:///C:/Users/agenti%20AI/Desktop/r.html');
  assert.equal(N.fileDiQuestoComputer('/home/utente/r.pdf'), 'file:///home/utente/r.pdf');
  assert.equal(N.fileDiQuestoComputer('file://localhost/tmp/x.png'), 'file:///tmp/x.png');
});

test('una cartella di rete, in ogni grafia, non è un file di questo computer', () => {
  for (const u of ['file://nas/condivisa/x.html', '\\\\nas\\condivisa\\x.html', 'file:////nas/condivisa/x.html', 'file:///%5C%5Cnas/x.html',
    'https://example.com/x.html', 'data:text/html,x', '']) {
    assert.equal(N.fileDiQuestoComputer(u), '', u);
  }
});

test('il percorso sul disco: casa, disco di Windows, niente percorsi di rete', () => {
  assert.equal(F.percorsoDi('file:///~/Scaricati/foto.jpg'), join(homedir(), 'Scaricati', 'foto.jpg'));
  assert.equal(F.percorsoDi('file://nas/x'), null);
  if (process.platform !== 'win32') assert.equal(F.percorsoDi('file:///tmp/a%20b/c.html'), '/tmp/a b/c.html');
});

test('il percorso l\'ha scritto l\'utente: con le barre all\'altro verso, con gli spazi o il %20, con la «~»', () => {
  const p = join(homedir(), 'Desktop', 'Filo report', 'r.html');
  const scritto = (parole) => F.scrittoDallUtente(p, parole);
  assert.equal(scritto(`aprimi ${p}`), true);
  assert.equal(scritto(`aprimi ${p.replace(/[\\/]/g, '\\')}`), true);
  assert.equal(scritto(`apri file://${p.replace(/\\/g, '/').replace(/ /g, '%20')}`), true);
  assert.equal(scritto('apri ~/Desktop/Filo report/r.html'), true);
  assert.equal(scritto('apri il report di ieri'), false);
  assert.equal(scritto(`apri ${join(homedir(), 'Desktop', 'Filo report')}`), false, 'la cartella non è il file');
  assert.equal(scritto(''), false);
});

test('aprire un file di questo computer non manda fuori dati: niente avviso «potrebbe inviare tuoi dati»', () => {
  const X = globalThis.SN_URL_EXFIL;
  const memoria = 'Si chiama Mario Rossi, vive a Bologna.';
  const file = X.valutaUscita({ type: 'NAVIGA', url: 'file:///home/Mario%20Rossi%20Bologna/report.html' }, { memoria });
  assert.equal(file.exfil, false);
  assert.equal(file.blocca, false);
  const rete = X.valutaUscita({ type: 'NAVIGA', url: 'https://x.example/Mario-Rossi-Bologna' }, { memoria });
  assert.equal(rete.exfil, true, 'un indirizzo web con gli stessi dati resta un\'uscita');
});

test('un file che non si apre dice il suo perché, non «bloccato per sicurezza»', () => {
  const { avvisoFileNonAperto } = require('../../src/main/services/indirizzoFermato.js');
  assert.equal(avvisoFileNonAperto({ motivo: 'assente', percorso: '/home/u/r.html' }).testo, 'File non trovato: /home/u/r.html');
  assert.equal(avvisoFileNonAperto({ motivo: 'tipo', percorso: '/home/u/l.docx' }).testo, 'Questo tipo di file non si mostra in una scheda: /home/u/l.docx');
  assert.equal(avvisoFileNonAperto({ motivo: 'rete', percorso: 'file://nas/x.html' }).testo, 'Percorso di rete bloccato per sicurezza: //nas/x.html');
});

test('un file col percorso non scritto dall\'utente chiede il suo OK, e la conferma dice quale file', () => {
  const L = globalThis.SN_ACTION_LEVELS;
  const a = { type: 'NAVIGA', url: 'file:///home/u/r.html', _fileDelComputer: '/home/u/r.html' };
  assert.equal(L.costoFor(a), 1);
  assert.equal(L.costoFor({ ...a, _fileNonScritto: true }), 2);
  const d = JSON.stringify(L.REGISTRY.NAVIGA.describe({ ...a, _fileNonScritto: true }));
  assert.match(d, /\/home\/u\/r\.html/);
  assert.match(d, /non l'hai scritto tu/);
});
