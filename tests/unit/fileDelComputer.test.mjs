// #1905 — Un file del computer si apre in una scheda se l'utente ne ha dato il percorso: quale indirizzo è un file di
// questo computer (mai una cartella di rete), quando il percorso l'ha scritto lui, e che aprirlo non è un'uscita di dati.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path, { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

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

test('una cartella montata da un altro computer (/net/<host> del Mac) è rete, e Filo non la tocca nemmeno per vedere se c\'è', { skip: process.platform === 'win32' }, async () => {
  const fs = require('node:fs');
  const toccati = [];
  const stat = fs.promises.stat;
  fs.promises.stat = async (p) => { toccati.push(String(p)); return stat(p); };
  try {
    const g = await F.giudica('file:///net/segreto-mario-rossi/condivisa/x.html');
    assert.equal(g.ok, false);
    assert.equal(g.motivo, 'rete');
    assert.deepEqual(toccati, []);
  } finally { fs.promises.stat = stat; }
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

// La concessione di una scheda: cosa legge la pagina del file aperto (sessione e CSP le prova tests/file-del-computer.spec.mjs).
function conCasa(fn) {
  const radice = cartellaTemporanea('casa-');
  const casa = join(radice, 'utente');
  mkdirSync(casa, { recursive: true });
  const prima = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = casa;
  process.env.USERPROFILE = casa;
  try { return fn(casa, radice); } finally {
    for (const [k, v] of Object.entries(prima)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('in una cartella qualunque la pagina legge le sue risorse e le sottocartelle, non i file nascosti né quelli senza estensione', () => conCasa((casa) => {
  const dir = join(casa, 'Scaricati', 'sito');
  const c = F.concessioneDi(join(dir, 'index.html'));
  const legge = (...p) => F.permesso(c, join(dir, ...p));
  assert.equal(legge('index.html'), true);
  assert.equal(legge('foto.png'), true);
  assert.equal(legge('index_files', 'stile.css'), true);
  assert.equal(legge('dati.xml'), true);
  assert.equal(legge('.git', 'config'), false);
  assert.equal(legge('sub', '.env'), false);
  assert.equal(legge('pagina'), false, 'un file senza estensione non si apre come pagina');
  assert.equal(legge('lettera.docx'), false);
  assert.equal(F.permesso(c, join(casa, 'Scaricati', 'altro.png')), false, 'la cartella sopra no');
  assert.equal(F.permesso(c, join(casa, '.ssh', 'id_rsa')), false);
}));

test('aperto un file nella cartella di casa, la pagina legge solo sé e i file che nomina', () => conCasa((casa) => {
  writeFileSync(join(casa, 'appunti.html'), `<link rel="stylesheet" href="stile.css"><img src='img/a.png'>
    <img srcset="b.png 1x, c.png 2x"><div style="background:url(&quot;d.jpg&quot;)"></div><style>i{background:url(e.webp)}</style>
    <img src=".ssh/id_rsa"><script src="chiave"></script><img src="../fuori.png"><a href="Documenti/conto.pdf">conto</a>`);
  const c = F.concessioneDi(join(casa, 'appunti.html'));
  assert.equal(c.cartella, null, 'la casa non si concede intera');
  const legge = (...p) => F.permesso(c, join(casa, ...p));
  for (const p of [['appunti.html'], ['stile.css'], ['img', 'a.png'], ['b.png'], ['c.png'], ['e.webp'], ['Documenti', 'conto.pdf']]) {
    assert.equal(legge(...p), true, p.join('/'));
  }
  for (const p of [['.ssh', 'id_rsa'], ['chiave'], ['altro.png'], ['Documenti', 'tasse.pdf'], ['img', 'z.png']]) {
    assert.equal(legge(...p), false, p.join('/'));
  }
  assert.equal(F.permesso(c, join(casa, '..', 'fuori.png')), false, 'fuori dalla casa no');
}));

test('la radice di un disco e una cartella che contiene la casa non si concedono intere', () => conCasa((casa, radice) => {
  assert.equal(F.concessioneDi(join(path.parse(casa).root, 'x.html')).cartella, null);
  assert.equal(F.concessioneDi(join(radice, 'x.html')).cartella, null);
  const sotto = F.concessioneDi(join(casa, 'Desktop', 'x.html'));
  assert.notEqual(sotto.cartella, null);
}));

test('la CSP dei file toglie file: a fetch, XHR, riquadri e worker', () => {
  for (const d of ['connect-src', 'frame-src', 'worker-src']) {
    const v = F.CSP_DOCUMENTO.split(';').map((s) => s.trim()).find((s) => s.startsWith(d));
    assert.ok(v && !/\bfile:|\*|'self'/.test(v), d);
  }
  assert.match(F.CSP_DOCUMENTO, /object-src 'none'/);
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
