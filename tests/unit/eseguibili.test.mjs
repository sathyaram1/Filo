// Unit test per src/shared/eseguibili.js — "questo file il sistema lo ESEGUE?".
//
// #588: è la lista che decide dove va l'attrito. Un falso negativo qui è un
// programma che entra nei Download senza che nessuno lo abbia detto, quindi si
// sorvegliano i trucchi noti sul nome (doppia estensione, punto in coda,
// maiuscole, caratteri che invertono la lettura) e la regola dei siti fidati,
// dove un sottodominio di troppo aprirebbe la porta a chiunque.
// Logica pura → niente Electron, gira in millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'eseguibili.js'));
const E = globalThis.SN_ESEGUIBILI;

test('le estensioni nominate nel feedback sono tutte nella lista', () => {
  // Windows e Mac erano il minimo chiesto; Linux ci sta perché un .sh scaricato
  // su Windows finisce comunque sul computer di qualcun altro.
  for (const ext of ['exe', 'msi', 'bat', 'cmd', 'scr', 'lnk', 'ps1', 'vbs', 'js', 'jar', 'dmg', 'pkg', 'sh']) {
    assert.equal(E.eEseguibile(`installa.${ext}`), true, `manca .${ext}`);
  }
});

test('un file qualunque non è un programma: l’attrito va solo dove serve', () => {
  for (const nome of ['report.pdf', 'foto.jpg', 'archivio.zip', 'musica.mp3',
    'dati.csv', 'pagina.html', 'lettera.docx', 'senzaestensione', 'video.mp4']) {
    assert.equal(E.eEseguibile(nome), false, `falso allarme su ${nome}`);
  }
});

test('conta l’ULTIMA estensione: «foto.jpg.exe» è un programma', () => {
  assert.equal(E.eEseguibile('foto.jpg.exe'), true);
  assert.equal(E.eEseguibile('fattura.pdf.scr'), true);
  // E il contrario resta vero: un .exe nel mezzo del nome non fa un programma.
  assert.equal(E.eEseguibile('exe.txt'), false);
  assert.equal(E.eEseguibile('setup.exe.txt'), false);
});

test('maiuscole, punti e spazi in coda non saltano il controllo', () => {
  // Windows ignora punti e spazi finali: «setup.exe.» apre lo stesso programma.
  assert.equal(E.eEseguibile('SETUP.EXE'), true);
  assert.equal(E.eEseguibile('setup.Exe'), true);
  assert.equal(E.eEseguibile('setup.exe.'), true);
  assert.equal(E.eEseguibile('setup.exe '), true);
  assert.equal(E.eEseguibile('setup.exe. . '), true);
});

test('il nome che inverte la lettura resta un programma, e si mostra com’è', () => {
  // «fattura<RLO>txt.exe» a schermo si legge «fatturaexe.txt».
  const ingannevole = 'fattura‮txt.exe';
  assert.equal(E.eEseguibile(ingannevole), true);
  assert.equal(E.nomeVisibile(ingannevole), 'fatturatxt.exe');
  assert.equal(E.nomeVisibile('nor​male.pdf'), 'normale.pdf');
});

test('il nome di un file senza estensione non inventa un’estensione', () => {
  assert.equal(E.estensione('.bashrc'), '');   // solo un punto iniziale
  assert.equal(E.estensione('download'), '');
  assert.equal(E.estensione(''), '');
  assert.equal(E.eEseguibile(null), false);
  assert.equal(E.eEseguibile(undefined), false);
});

test('il sito è quello da mostrare: senza www e senza porta', () => {
  assert.equal(E.sito('https://www.esempio.com/percorso/setup.exe'), 'esempio.com');
  assert.equal(E.sito('http://127.0.0.1:8080/x.exe'), '127.0.0.1');
  assert.equal(E.sito('non-un-indirizzo'), '');
  assert.equal(E.sito(''), '');
});

test('un sito fidato copre i suoi sottodomini, mai chi se lo mette davanti', () => {
  const lista = ['mozilla.org'];
  assert.equal(E.fidato('https://mozilla.org/firefox.dmg', lista), true);
  assert.equal(E.fidato('https://download.mozilla.org/firefox.dmg', lista), true);
  assert.equal(E.fidato('https://www.mozilla.org/firefox.dmg', lista), true);
  // Il caso che conta: un dominio che CONTIENE quello fidato non è quello fidato.
  assert.equal(E.fidato('https://mozilla.org.evil.com/setup.exe', lista), false);
  assert.equal(E.fidato('https://notmozilla.org/setup.exe', lista), false);
  assert.equal(E.fidato('https://altro.com/setup.exe', lista), false);
  assert.equal(E.fidato('https://mozilla.org/x.exe', []), false);
});

test('le righe scritte a mano si normalizzano, e le inservibili si scartano', () => {
  assert.deepEqual(
    E.normalizzaSiti(['https://www.Mozilla.org/download', ' apache.org ', '', 'apache.org']),
    ['mozilla.org', 'apache.org'],
  );
  // Niente etichetta singola, niente riga vuota: non corrisponderebbero mai.
  assert.deepEqual(E.normalizzaSiti(['mozilla', '   ', '...']), []);
  assert.deepEqual(E.normalizzaSiti('mozilla.org\napache.org'), ['mozilla.org', 'apache.org']);
});

test('le frasi nominano il file e il sito: sono quelle su cui si decide', () => {
  const t = E.testoScarica('setup.exe', 'https://www.dubbio.example/setup.exe');
  assert.ok(t.includes('setup.exe'), t);
  assert.ok(t.includes('dubbio.example'), t);
  assert.ok(/programma/i.test(t), t);

  const a = E.testoApri('setup.exe', 'https://dubbio.example/setup.exe');
  assert.ok(a.includes('setup.exe') && a.includes('dubbio.example'), a);
  assert.ok(/esegu/i.test(a), a);

  // Indirizzo illeggibile: la frase resta una frase, senza «da » appeso.
  const senza = E.testoScarica('setup.exe', '');
  assert.ok(!/ da /.test(senza), senza);
});
