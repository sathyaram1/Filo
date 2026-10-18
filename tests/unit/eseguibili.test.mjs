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
  // #590: un'estensione non latina (сайт.рф) è salvata nella forma «xn--» e resta valida.
  assert.deepEqual(E.normalizzaSiti(['xn--80aswg.xn--p1ai']), ['xn--80aswg.xn--p1ai']);
  assert.equal(E.fidato('https://сайт.рф/setup.exe', ['xn--80aswg.xn--p1ai']), true);
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

test('un programma fabbricato dalla pagina porta con sé il sito che l’ha fatto', () => {
  // `blob:` incapsula l'origine di chi l'ha creato: leggerla è l'unico modo di
  // dire da dove arriva un file che il sito non ha servito da un indirizzo.
  assert.equal(E.sito('blob:https://www.dubbio.example/2f1c-44'), 'dubbio.example');
  assert.equal(E.sito('blob:http://127.0.0.1:8080/2f1c-44'), '127.0.0.1');
  // Un `data:` non porta nulla: chi chiama deve andarlo a chiedere alla pagina.
  assert.equal(E.sito('data:application/octet-stream;base64,TVo='), '');
});

test('il sito deciso una volta vale come l’indirizzo, per il confronto e per la frase', () => {
  // Il record conserva il NOME del sito, non l'indirizzo: le stesse regole
  // devono rispondere uguale alle due forme, o la deroga e la frase si
  // scollegherebbero dalla domanda che le ha precedute.
  assert.equal(E.comeSito('mozilla.org'), 'mozilla.org');
  assert.equal(E.comeSito('www.Mozilla.org'), 'mozilla.org');
  assert.equal(E.comeSito('127.0.0.1'), '127.0.0.1');
  assert.equal(E.comeSito(''), '');

  assert.equal(E.fidato('mozilla.org', ['mozilla.org']), true);
  assert.equal(E.fidato('download.mozilla.org', ['mozilla.org']), true);
  assert.equal(E.fidato('mozilla.org.evil.com', ['mozilla.org']), false);
  assert.equal(E.fidato('', ['mozilla.org']), false);

  assert.ok(E.testoScarica('setup.exe', 'dubbio.example').includes('da dubbio.example'));
  assert.ok(E.testoApri('setup.exe', 'dubbio.example').includes('da dubbio.example'));
});

test('un sito incerto si dice incerto, in ogni frase che nomina il sito', () => {
  const E = globalThis.SN_ESEGUIBILI;
  assert.equal(E.provenienza('forum.it', false), 'da forum.it');
  const incerto = E.provenienza('forum.it', true);
  assert.match(incerto, /forum\.it/);
  assert.notEqual(incerto, 'da forum.it');
  assert.match(incerto, /altri siti/);
  assert.ok(E.testoScarica('setup.exe', 'forum.it', true).includes(incerto));
  assert.ok(E.testoApri('setup.exe', 'forum.it', true).includes(incerto));
  assert.equal(E.provenienza('', true), '');
});

test('dopo un rimando la frase nomina il sito cliccato e quello che ha servito il file (#588.3)', () => {
  const E = globalThis.SN_ESEGUIBILI;
  const servito = 'https://objects.githubusercontent.com/release/setup.exe';
  assert.equal(E.servitoDa('github.com', servito), 'objects.githubusercontent.com');
  assert.equal(E.provenienza('github.com', false, servito, 'setup.exe'),
    'da github.com, servito da objects.githubusercontent.com');
  assert.ok(E.testoScarica('setup.exe', 'github.com', false, servito)
    .includes('programma da github.com, servito da objects.githubusercontent.com.'));
  assert.ok(E.testoApri('setup.exe', 'github.com', false, servito)
    .includes('da github.com, servito da objects.githubusercontent.com.'));
  assert.ok(E.testoScarica('ubuntu.iso', 'ubuntu.com', false, 'https://cdimage.example/u.iso')
    .includes('da ubuntu.com, servita da cdimage.example.'));
  // Stesso sito o un suo sottodominio: un nome solo, come per la fiducia.
  for (const stesso of ['https://www.mozilla.org/x.exe', 'https://download.mozilla.org/x.exe', '', 'data:,x']) {
    assert.equal(E.servitoDa('mozilla.org', stesso), '', stesso);
    assert.equal(E.provenienza('mozilla.org', false, stesso), 'da mozilla.org');
  }
  // Il genitore di chi è stato cliccato è un altro nome: la fiducia non lo copre.
  assert.equal(E.servitoDa('cdn.sito.it', 'https://sito.it/a.exe'), 'sito.it');
});

test('i formati che Windows monta o esegue senza essere un .exe sono nella lista (#588.1)', () => {
  // Un .iso montato mette setup.exe a un doppio clic e non porta la marca di
  // file scaricato: è la strada più usata per scavalcare i controlli.
  for (const ext of ['iso', 'img', 'vhd', 'vhdx', 'appref-ms', 'xll', 'library-ms',
    'settingcontent-ms', 'diagcab']) {
    assert.equal(E.eEseguibile(`setup.${ext}`), true, `manca .${ext}`);
    assert.equal(E.eEseguibile(`SETUP.${ext.toUpperCase()}. `), true, `.${ext} maiuscolo con punto in coda`);
  }
  assert.equal(E.estensione('app.appref-ms'), 'appref-ms');
  // Un nome che finisce solo con «-ms» non è l'estensione composta.
  assert.equal(E.eEseguibile('note-ms.txt'), false);
});

test('un’immagine disco si dice immagine disco, non «programma»', () => {
  for (const nome of ['setup.iso', 'disco.IMG', 'win.vhdx', 'app.dmg']) {
    assert.equal(E.eImmagineDisco(nome), true, nome);
    const s = E.testoScarica(nome, 'dubbio.example');
    const a = E.testoApri(nome, 'dubbio.example');
    assert.match(s, /immagine disco/, s);
    assert.match(s, /programmi/, s);
    assert.ok(s.includes('da dubbio.example') && s.includes(nome), s);
    assert.match(a, /immagine disco/, a);
    assert.match(a, /doppio clic/, a);
    assert.ok(a.includes('da dubbio.example'), a);
    assert.match(E.titoloApri(nome), /immagine disco/);
  }
  assert.equal(E.eImmagineDisco('setup.exe'), false);
  assert.equal(E.titoloApri('setup.exe'), E.TITOLO_APRI);
  assert.match(E.testoScarica('setup.exe', 'dubbio.example'), /è un programma/);
  assert.ok(E.testoScarica('setup.iso', 'forum.it', true).includes(E.provenienza('forum.it', true)));
});
