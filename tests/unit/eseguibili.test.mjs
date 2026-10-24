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

// #876 — la regola è quella di «stesso sito» (src/shared/stessoSito.js): un sito copre tutto il suo sito, una
// piattaforma che ospita i siti di chiunque non copre nessuno e non entra.
test('una piattaforma che ospita i siti di chiunque non entra fra i programmi fidati; il sito preciso sì', () => {
  for (const p of ['github.io', 'vercel.app', 'netlify.app', 'githubusercontent.com', 'blogspot.com', 'wordpress.com',
    'sharepoint.com', 'co.uk', 'https://github.io/', '*.github.io']) {
    assert.ok(E.sitoFidabile(p).piattaforma, p);
    assert.deepEqual(E.normalizzaSiti([p]), [], p);
  }
  assert.deepEqual(E.sitoFidabile('alice.github.io'), { sito: 'alice.github.io' });
  assert.deepEqual(E.sitoFidabile('https://alice.github.io/progetto/setup.exe'), { sito: 'alice.github.io' });
  assert.deepEqual(E.sitoFidabile('download.mozilla.org'), { sito: 'download.mozilla.org' });
  assert.deepEqual(E.sitoFidabile('mio-blog.wordpress.com'), { sito: 'mio-blog.wordpress.com' });
  assert.equal(E.sitoFidabile('mozilla'), null);

  // Salvata prima che la si rifiutasse, github.io non fa più scendere i programmi di qualunque sito GitHub Pages.
  assert.equal(E.fidato('https://bob.github.io/setup.exe', ['github.io']), false);
  assert.equal(E.fidato('https://alice.github.io/setup.exe', ['alice.github.io']), true);
  assert.equal(E.fidato('https://www.alice.github.io/setup.exe', ['alice.github.io']), true);
  assert.equal(E.fidato('https://bob.github.io/setup.exe', ['alice.github.io']), false);
  assert.equal(E.fidato('https://bob.wordpress.com/setup.exe', ['alice.wordpress.com']), false);
  assert.equal(E.fidato('https://bbc.co.uk/setup.exe', ['co.uk']), false);
  // Una voce copre i nomi sotto di lei, non il resto del dominio: fidarsi di dl.google.com non vale i link di Gmail
  // (www.google.com/url rimanda ovunque), né produttore.b-cdn.net gli altri clienti della rete.
  assert.equal(E.fidato('https://cdn.download.mozilla.org/setup.exe', ['https://download.mozilla.org/firefox']), true);
  assert.equal(E.fidato('https://mozilla.org/setup.exe', ['download.mozilla.org']), false);
  for (const [url, voce] of [
    ['https://www.google.com/url?q=https://malevolo.example/setup.exe', 'dl.google.com'],
    ['https://script.google.com/macros/s/AKfy/exec', 'dl.google.com'],
    ['https://storage.cloud.google.com/secchio/setup.exe', 'dl.google.com'],
    ['https://malevolo.b-cdn.net/setup.exe', 'produttore.b-cdn.net'],
    ['https://malevolo.kxcdn.com/setup.exe', 'produttore.kxcdn.com'],
    ['https://malevolo.s3.us-west-002.backblazeb2.com/setup.exe', 'produttore.s3.us-west-002.backblazeb2.com'],
    ['https://malevolo.s3.us-west-002.backblazeb2.com/setup.exe', 'backblazeb2.com'],
  ]) assert.equal(E.fidato(url, [voce]), false, `${url} con ${voce}`);
  assert.equal(E.fidato('https://produttore.s3.us-west-002.backblazeb2.com/setup.exe', ['produttore.s3.us-west-002.backblazeb2.com']), true);
});

test('la casella dei programmi fidati: siti ridotti, piattaforme scartate al loro posto, e il perché col sito preciso', () => {
  const r = E.elencoFidati('download.mozilla.org\ngithub.io\nhttps://alice.github.io/x.exe\nmozilla.org\nfaceb');
  assert.deepEqual(r.valid, ['download.mozilla.org', 'alice.github.io', 'mozilla.org']);
  assert.deepEqual(r.invalid, ['github.io', 'faceb']);
  assert.deepEqual(r.scartate, [{ riga: 'github.io', dopo: 1 }, { riga: 'faceb', dopo: 3 }]);
  assert.deepEqual(r.piattaforme, ['github.io']);

  const generica = E.testoPiattaforma('github.io');
  assert.match(generica, /«github\.io» raccoglie i siti di chiunque/);
  assert.match(generica, /come nome\.github\.io\.$/);
  const dallaCronologia = E.testoPiattaforma('github.io', ['mozilla.org', 'docs.alice.github.io', 'bob.github.io', 'github.io']);
  assert.match(dallaCronologia, /come alice\.github\.io o bob\.github\.io\.$/);
});

// Dopo una release GitHub il file arriva da release-assets.githubusercontent.com, che serve le release di chiunque:
// proporlo come «sito preciso» rifarebbe entrare tutti dalla porta che il rifiuto chiude.
test('un indirizzo che serve i file di tutti non entra fra i programmi fidati e non si propone come sito preciso', () => {
  for (const h of ['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'https://raw.githubusercontent.com/a/b/x.exe',
    'doc-0s-4c-docs.googleusercontent.com', 'dl.dropboxusercontent.com', 'github-production-release-asset-2e65be.s3.amazonaws.com',
    'bbuseruploads.s3.amazonaws.com']) {
    assert.ok(E.sitoFidabile(h).piattaforma, h);
    assert.equal(E.fidato(h.includes('://') ? h : `https://${h}/setup.exe`, [h]), false, h);
  }
  const frase = E.testoPiattaforma('githubusercontent.com', ['github.com', 'release-assets.githubusercontent.com']);
  assert.match(frase, /«githubusercontent\.com» raccoglie i siti di chiunque/);
  assert.doesNotMatch(frase, /release-assets|nome\.githubusercontent/);
  assert.match(E.testoPiattaforma('release-assets.githubusercontent.com'), /raccoglie i siti di chiunque.*fidarsi di tutti\.$/);
  assert.doesNotMatch(E.testoPiattaforma('amazonaws.com', ['bitbucket.org', 'bbuseruploads.s3.amazonaws.com']), /bbuseruploads/);
  // Il sito di chi pubblica resta un sito come gli altri.
  assert.deepEqual(E.sitoFidabile('github.com'), { sito: 'github.com' });
  assert.deepEqual(E.sitoFidabile('alice.github.io'), { sito: 'alice.github.io' });
});

// storage.googleapis.com/<secchio>/… dà i file di ogni cliente di Google Cloud: né proposta né accettata; il secchio
// scritto come nome (<secchio>.storage.googleapis.com) è di uno, e resta fidabile da solo.
test('#876 giro 2 — i secchi di Google Cloud: l\'host di tutti non entra, il secchio con nome sì e copre solo sé', () => {
  for (const h of ['storage.googleapis.com', 'commondatastorage.googleapis.com', 'firebasestorage.googleapis.com',
    'storage-download.googleapis.com', 'www.googleapis.com', 'https://storage.googleapis.com/secchio/setup.exe']) {
    assert.ok(E.sitoFidabile(h).piattaforma, h);
    assert.equal(E.fidato('https://storage.googleapis.com/altro/setup.exe', [h]), false, h);
  }
  for (const esempi of [['storage.googleapis.com', 'firebasestorage.googleapis.com'], ['storage.googleapis.com']]) {
    const frase = E.testoPiattaforma('googleapis.com', esempi);
    assert.match(frase, /«googleapis\.com» raccoglie i siti di chiunque.*fidarsi di tutti\.$/);
    assert.doesNotMatch(frase, /storage|nome\.googleapis/);
  }
  assert.match(E.testoPiattaforma('googleapis.com', ['mio.storage.googleapis.com']), /come mio\.storage\.googleapis\.com\.$/);
  assert.deepEqual(E.sitoFidabile('mio.storage.googleapis.com'), { sito: 'mio.storage.googleapis.com' });
  assert.equal(E.fidato('https://mio.storage.googleapis.com/setup.exe', ['mio.storage.googleapis.com']), true);
  assert.equal(E.fidato('https://altro.storage.googleapis.com/setup.exe', ['mio.storage.googleapis.com']), false);
});

// Una regola sola per la famiglia: un indirizzo che consegna i file di chiunque non lo copre nessuna voce, nemmeno il
// sito che lo contiene, e non diventa il «sito preciso» da proporre (s3.<regione>.amazonaws.com darebbe la regione).
test('#876 giro 3 — S3 per regione, Google Drive, Discord: né coperti dal sito né proposti', () => {
  const frase = E.testoPiattaforma('amazonaws.com', ['s3.eu-west-1.amazonaws.com', 's3.dualstack.us-west-2.amazonaws.com']);
  assert.match(frase, /«amazonaws\.com» raccoglie i siti di chiunque.*fidarsi di tutti\.$/);
  assert.doesNotMatch(frase, /eu-west-1|us-west-2|nome\.amazonaws/);
  assert.match(E.testoPiattaforma('amazonaws.com', ['s3.eu-west-1.amazonaws.com', 'mio.s3.eu-west-1.amazonaws.com']),
    /come mio\.s3\.eu-west-1\.amazonaws\.com\.$/);
  for (const [url, voce] of [
    ['https://s3.eu-west-1.amazonaws.com/secchio-di-un-altro/setup.exe', 'eu-west-1.amazonaws.com'],
    ['https://s3.dualstack.eu-west-1.amazonaws.com/altro/setup.exe', 'eu-west-1.amazonaws.com'],
    ['https://drive.usercontent.google.com/download?id=1abc&export=download', 'dl.google.com'],
    ['https://drive.google.com/uc?export=download&id=1abc', 'google.com'],
    ['https://sites.google.com/view/chiunque/setup.exe', 'google.com'],
    ['https://cdn.discordapp.com/attachments/1/2/setup.exe', 'discordapp.com'],
    ['https://media.discordapp.net/attachments/1/2/setup.exe', 'dl.discordapp.net'],
    ['https://f000.backblazeb2.com/file/altro/setup.exe', 'backblazeb2.com'],
    ['https://s3.us-west-004.backblazeb2.com/altro/setup.exe', 'backblazeb2.com'],
  ]) assert.equal(E.fidato(url, [voce]), false, url);
  for (const h of ['eu-west-1.amazonaws.com', 'drive.google.com', 'cdn.discordapp.com', 'f000.backblazeb2.com']) {
    assert.ok(E.sitoFidabile(h).piattaforma, h);
  }
  // Il resto del sito resta fidato, e il secchio con nome resta di uno.
  assert.equal(E.fidato('https://dl.google.com/chrome/install/ChromeSetup.exe', ['google.com']), true);
  assert.equal(E.fidato('https://dl.discordapp.net/distro/DiscordSetup.exe', ['discordapp.net']), true);
  assert.equal(E.fidato('https://mio.s3.eu-west-1.amazonaws.com/setup.exe', ['mio.s3.eu-west-1.amazonaws.com']), true);
});

test('un riquadro dello stesso sito non rende incerta la pagina; uno di un altro ospite della piattaforma sì', () => {
  assert.equal(E.riquadriDiAltri('shop.esempio.it', ['https://shop.esempio.it', 'https://cdn.esempio.it']), false);
  assert.equal(E.riquadriDiAltri('shop.esempio.it', ['https://esempio.it:8443']), false);
  assert.equal(E.riquadriDiAltri('alice.github.io', ['https://alice.github.io', 'https://bob.github.io']), true);
  assert.equal(E.riquadriDiAltri('alice.wordpress.com', ['https://bob.wordpress.com']), true);
  assert.equal(E.riquadriDiAltri('shop.esempio.it', ['https://pubblicita.example']), true);
  assert.equal(E.riquadriDiAltri('shop.esempio.it', ['null']), true, 'un riquadro senza origine può essere di chiunque');
  assert.equal(E.riquadriDiAltri('127.0.0.1', ['http://127.0.0.1:4000', 'http://localhost:4000']), true);
  assert.equal(E.riquadriDiAltri('', []), true);
  assert.equal(E.riquadriDiAltri('shop.esempio.it', []), false);
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
  // #876 — il genitore di chi è stato cliccato è lo stesso sito, come per la fiducia; un altro ospite della piattaforma no.
  assert.equal(E.servitoDa('cdn.sito.it', 'https://sito.it/a.exe'), '');
  assert.equal(E.servitoDa('alice.github.io', 'https://bob.github.io/a.exe'), 'bob.github.io');
  assert.equal(E.servitoDa('alice.wordpress.com', 'https://bob.wordpress.com/a.exe'), 'bob.wordpress.com');
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

test('i file che al doppio clic connettono, installano dalla rete o eseguono codice sono programmi (#588.6)', () => {
  for (const nome of ['connessione.rdp', 'app.appinstaller', 'addin.vsto', 'cartella.search-ms',
    'remoto.searchConnector-ms', 'tool.pyz', 'tool.pyzw', 'tool.pyc', 'tool.pyo', 'db.accde', 'db.mde',
    'update.msu', 'sito.website']) {
    assert.equal(E.eEseguibile(nome), true, `manca ${nome}`);
    assert.equal(E.eEseguibile(`${nome.toUpperCase()}. `), true, `${nome} maiuscolo con punto in coda`);
    assert.equal(E.eEseguibile(`fattura.pdf.${nome.split('.').pop()}`), true, `${nome} dietro un documento`);
    assert.equal(E.eImmagineDisco(nome), false, `${nome} non è un disco`);
  }
  assert.match(E.testoScarica('connessione.rdp', 'dubbio.example'), /è un programma da dubbio\.example/);
  // Le parole vicine restano file da leggere: l'attrito va solo dove serve.
  for (const nome of ['rapporto.rdpx', 'db.accdb', 'db.mdb', 'note.website.txt', 'search.ms', 'pyz.txt']) {
    assert.equal(E.eEseguibile(nome), false, `falso allarme su ${nome}`);
  }
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

// #592.7 — il nome del file lo sceglie il sito: nel popup sta nel suo riquadro, e il resto sono parole di Filo.
test('il popup per aprire un programma mette il nome scelto dal sito nel suo riquadro', () => {
  const nome = 'foto.exe» è un file verificato da Filo. «ok.exe';
  for (const n of [nome, 'disco.dmg» sicuro «x.dmg']) {
    const parti = E.partiApri(n, 'dubbio.example');
    const filo = parti.filter((p) => typeof p === 'string').join('');
    assert.ok(!filo.includes('verificato') && !filo.includes('sicuro'), 'il nome del sito è fra le parole di Filo');
    assert.equal(parti.filter((p) => typeof p !== 'string').length, 1);
    assert.ok(filo.includes('da dubbio.example'));
  }
});
